"""기능별 상태 확인·미리보기·적용 — 가짜 앱 폴더(HERDR_APP_HOME)에서 스크립트를 실제로 돌려 본다.

앱 없이 되는 기능(title-sync·ccd-key·image-paste 의 이미 깔린 상태)만 끝까지 돌리고,
복제본 기능(my-agents 등)은 상태 판정만 본다.
  python -m pytest herdr/skills/herdr-use/desktop/tests
"""
import json
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)
SCRIPTS = os.path.join(DESKTOP, "scripts")
ASSETS = os.path.join(DESKTOP, "assets")
sys.path.insert(0, SCRIPTS)
import featurelib as fl  # noqa: E402

LAYOUT = {"root": {"type": "column", "children": [
    {"id": "main", "type": "block", "content": {"mod": "pane"}},
    {"id": "status", "type": "block", "size": {"px": 24}, "content": {"mod": "status"}},
    {"id": "ccd-key", "type": "block", "size": {"px": 0}, "content": {"mod": "ccd-key"}},  # 앱이 넣는 칸 흉내(기다림 생략)
]}}


@pytest.fixture
def home(tmp_path):
    h = tmp_path / "herdr-app"
    (h / "layouts").mkdir(parents=True)
    (h / "mods").mkdir()
    (h / "shared.json").write_text(json.dumps({"layout": "my-main"}), encoding="utf-8")
    (h / "layouts" / "my-main.json").write_text(json.dumps(LAYOUT, indent=2), encoding="utf-8")
    (h / "keys.json").write_text(json.dumps({"global": {}, "terminal": {}}, indent=2), encoding="utf-8")
    return h


def run(home, script, *args):
    env = {**os.environ, "HERDR_APP_HOME": str(home), "PYTHONIOENCODING": "utf-8"}
    path = os.path.join(DESKTOP, script) if script == "setup.py" else os.path.join(SCRIPTS, script)
    r = subprocess.run([sys.executable, path, *args], capture_output=True, env=env, timeout=60)
    return r.returncode, r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")


def tree(home):
    """폴더 안 모든 파일의 (시각, 내용) — 하나라도 바뀌었는지 보려고."""
    out = {}
    for root, _dirs, files in os.walk(home):
        for name in files:
            p = os.path.join(root, name)
            with open(p, "rb") as f:
                out[p] = (os.stat(p).st_mtime_ns, f.read())
    return out


def mtime(path):
    return os.stat(path).st_mtime_ns


def preinstall_image_paste(home):
    """image-paste 를 '이미 깔린' 상태로 — 빌드(csc)는 이 PC 에서 못 하므로 파일을 미리 놓는다."""
    d = home / "mods" / "image-paste"
    d.mkdir()
    for name in ("main.js", "mod.json", "clipimg.cs"):
        (d / name).write_bytes((open(os.path.join(ASSETS, "image-paste", name), "rb")).read())
    (d / "clipimg.exe").write_bytes(b"MZ")
    keys = json.loads((home / "keys.json").read_text(encoding="utf-8"))
    keys["terminal"]["ctrl-shift-v"] = "image-paste.paste"
    (home / "keys.json").write_text(json.dumps(keys, indent=2), encoding="utf-8")
    layout = json.loads((home / "layouts" / "my-main.json").read_text(encoding="utf-8"))
    layout["root"]["children"].append({"id": "ip", "type": "block", "size": {"px": 0}, "content": {"mod": "image-paste"}})
    (home / "layouts" / "my-main.json").write_text(json.dumps(layout, indent=2), encoding="utf-8")


# ---- 같은 내용이면 안 씀 ----

@pytest.mark.parametrize("script, main", [
    ("install_title_sync.py", "mods/title-sync/main.js"),
    ("install_ccd_key.py", "mods/ccd-key/main.js"),
])
def test_second_apply_writes_nothing(home, script, main):
    code, out = run(home, script)
    assert code == 0, out
    assert "바뀜 → 최신" in out
    before = tree(home)
    code, out = run(home, script)
    assert code == 0, out
    assert "변경 없음" in out
    assert tree(home) == before  # mod 파일·keys.json·레이아웃·설치 기록 모두 그대로


def test_reinstall_after_stale_writes_only_that_feature(home):
    """ccd-key 를 깔고 title-sync 만 낡게 → setup --apply 는 title-sync 만 고치고 ccd-key/main.js 는 안 건드림."""
    assert run(home, "install_ccd_key.py")[0] == 0
    assert run(home, "install_title_sync.py")[0] == 0
    ts = home / "mods" / "title-sync" / "main.js"
    old = b"// old plugin version\n"
    ts.write_bytes(old)
    fl_manifest = home / ".herdr-custom" / "installed.json"
    manifest = json.loads(fl_manifest.read_text(encoding="utf-8"))
    manifest["mods/title-sync/main.js"] = fl.sha(old)  # 지난 판이 쓴 것처럼
    fl_manifest.write_text(json.dumps(manifest), encoding="utf-8")
    key_main = home / "mods" / "ccd-key" / "main.js"
    t_key = mtime(key_main)

    code, out = run(home, "setup.py")
    assert "title-sync   낡음(플러그인판과 다름: main.js)" in out
    assert "ccd-key      최신" in out

    code, out = run(home, "setup.py", "--apply")
    assert "바뀐 기능: title-sync" in out, out
    assert mtime(key_main) == t_key
    assert "mods/ccd-key" not in out.split("바뀐 파일:")[1].splitlines()[0]
    assert ts.read_bytes() == open(os.path.join(ASSETS, "title-sync", "main.js"), "rb").read()


def test_setup_apply_all_latest_changes_nothing(home):
    assert run(home, "install_title_sync.py")[0] == 0
    assert run(home, "install_ccd_key.py")[0] == 0
    preinstall_image_paste(home)
    before = tree(home)
    code, out = run(home, "setup.py", "--apply", "title-sync,ccd-key,image-paste")
    assert out.count("변경 없음") >= 3, out
    assert "바뀐 기능: 없음" in out
    assert "바뀐 파일: 없음" in out
    after = tree(home)
    changed = [p for p in after if before.get(p) != after[p] and ".herdr-custom" not in p]
    assert changed == []


# ---- 상태 확인·미리보기는 아무것도 안 씀 ----

def test_status_and_dry_run_write_nothing(home):
    before = tree(home)
    code, out = run(home, "install_title_sync.py", "--status")
    assert code == fl.EXIT_CODES[fl.MISSING] and "title-sync   없음" in out
    code, out = run(home, "install_title_sync.py", "--dry-run")
    assert "쓸 파일: mods/title-sync/main.js" in out and "할 일: 레이아웃 my-main: title-sync 칸 0개 → 1개" in out
    code, out = run(home, "setup.py")
    assert "title-sync" in out and "my-spaces" in out
    code, out = run(home, "setup.py", "--dry-run")
    assert "아무 파일도 쓰지 않았습니다" in out
    assert tree(home) == before


def test_status_json(home):
    code, out = run(home, "install_ccd_key.py", "--status", "--json")
    data = json.loads(out.strip().splitlines()[-1])
    assert data["feature"] == "ccd-key" and data["state"] == "missing"


# ---- 손으로 고친 흔적 ----

def test_hand_edit_is_detected_and_needs_force(home):
    assert run(home, "install_title_sync.py")[0] == 0
    main = home / "mods" / "title-sync" / "main.js"
    edited = main.read_bytes() + "\n// 시험 중\n".encode("utf-8")
    main.write_bytes(edited)

    code, out = run(home, "install_title_sync.py", "--status")
    assert code == fl.EXIT_CODES[fl.HAND] and "손으로 고친 흔적" in out

    code, out = run(home, "install_title_sync.py")
    assert code == fl.EXIT_CODES[fl.HAND] and "--force" in out
    assert main.read_bytes() == edited  # 안 덮음

    code, out = run(home, "setup.py", "--apply")
    assert "멈춘 기능(손으로 고친 흔적): title-sync" in out
    assert main.read_bytes() == edited

    code, out = run(home, "install_title_sync.py", "--force")
    assert code == 0, out
    backups = list((home / ".herdr-custom" / "backup").rglob("main.js"))
    assert len(backups) == 1 and backups[0].read_bytes() == edited
    assert main.read_bytes() != edited


def test_unrecorded_difference_is_stale_not_hand(home):
    """이 틀 이전에 깔린 파일(기록 없음)은 손으로 고쳤는지 모름 → 낡음(설치 기록 없음)."""
    assert run(home, "install_title_sync.py")[0] == 0
    (home / ".herdr-custom" / "installed.json").unlink()
    (home / "mods" / "title-sync" / "main.js").write_bytes(b"// older\n")
    code, out = run(home, "install_title_sync.py", "--status")
    assert code == fl.EXIT_CODES[fl.STALE] and "설치 기록 없음" in out


# ---- 고칠 문장 못 찾음 ----

def test_patch_missing_is_reported_without_writing(home):
    base = home / "mods" / "agents"
    base.mkdir()
    (base / "main.js").write_text('import { agents } from "herdr";\n// 앱이 바뀐 원본\n', encoding="utf-8")
    before = tree(home)
    code, out = run(home, "install_agents_name_only.py", "--status")
    assert code == fl.EXIT_CODES[fl.PATCH] and "고칠 문장 못 찾음" in out
    code, out = run(home, "install_agents_name_only.py")
    assert code == fl.EXIT_CODES[fl.PATCH] and "적용 안 함" in out
    assert tree(home) == before


# ---- featurelib 단위 ----

def test_write_if_changed_keeps_mtime_when_same(tmp_path, monkeypatch):
    monkeypatch.setattr(fl, "APP_HOME", str(tmp_path))
    monkeypatch.setattr(fl, "STATE_DIR", str(tmp_path / ".herdr-custom"))
    monkeypatch.setattr(fl, "MANIFEST", str(tmp_path / ".herdr-custom" / "installed.json"))
    target = str(tmp_path / "mods" / "x" / "main.js")
    assert fl.write_if_changed(target, b"a") is True
    t = mtime(target)
    assert fl.write_if_changed(target, b"a") is False
    assert mtime(target) == t
    assert fl.load_manifest() == {"mods/x/main.js": fl.sha(b"a")}
    assert fl.write_if_changed(target, b"b") is True


def test_evaluate_states(tmp_path, monkeypatch):
    monkeypatch.setattr(fl, "APP_HOME", str(tmp_path))
    monkeypatch.setattr(fl, "MANIFEST", str(tmp_path / "m.json"))
    f = tmp_path / "a.js"
    want = fl.Want(str(f), b"new")
    assert fl.evaluate(fl.Plan("x", files=(want,), present=False)).state == fl.MISSING
    f.write_bytes(b"new")
    assert fl.evaluate(fl.Plan("x", files=(want,))).state == fl.LATEST
    assert fl.evaluate(fl.Plan("x", files=(want,), checks=(fl.Check("키 다름", False),))).detail == "키 다름"
    assert fl.evaluate(fl.Plan("x", error="고칠 문장을 못 찾음", error_state=fl.PATCH)).state == fl.PATCH
    # 레이아웃만 되돌린(없음) 복제본을 손으로 고쳤으면 '없음'이 아니라 손으로 고친 흔적
    f.write_bytes(b"edited")
    (tmp_path / "m.json").write_text(json.dumps({"a.js": fl.sha(b"written-by-us")}), encoding="utf-8")
    assert fl.evaluate(fl.Plan("x", files=(want,), present=False)).state == fl.HAND
