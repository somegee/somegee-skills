"""resume-all — 설치·제거, my-tabs Resume 버튼 패치, 버튼 숫자·팝업 후보 규칙 일치, 이어하기 줄 만들기.

  python -m pytest herdr-desktop/skills/herdr-custom/desktop/tests/test_resume_all.py
"""
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)
SCRIPTS = os.path.join(DESKTOP, "scripts")
MAIN_JS = os.path.join(DESKTOP, "assets", "resume-all", "main.js")
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, HERE)
import featurelib as fl  # noqa: E402
import install_tabs_agent_name as tabs  # noqa: E402
from patchlib import apply_patches, ensure_imports  # noqa: E402
from test_feature_status import home, run, tree  # noqa: E402,F401  같은 가짜 앱 폴더

NODE = shutil.which("node")


def read_main() -> str:
    with open(MAIN_JS, encoding="utf-8") as f:
        return f.read()


# ---- 설치·제거 (my-tabs 없는 가짜 앱 폴더 — refresh 는 할 일 없음) ----

def test_install_twice_then_remove(home):
    code, out = run(home, "install_resume_all.py", "--status")
    assert code == fl.EXIT_CODES[fl.MISSING], out
    code, out = run(home, "install_resume_all.py")
    assert code == 0 and "바뀜 → 최신" in out, out
    mod = home / "mods" / "resume-all"
    assert sorted(os.listdir(mod)) == ["main.js", "mod.json", "read_sessions.ps1", "resume.svg"]
    manifest = json.loads((home / ".herdr-custom" / "installed.json").read_text(encoding="utf-8"))
    assert "mods/resume-all/read_sessions.ps1" in manifest

    before = tree(home)
    code, out = run(home, "install_resume_all.py")
    assert code == 0 and "변경 없음" in out, out
    assert tree(home) == before

    code, out = run(home, "install_resume_all.py", "--remove")
    assert code == 0, out
    assert not mod.exists()
    assert run(home, "install_resume_all.py", "--status")[0] == fl.EXIT_CODES[fl.MISSING]


def test_setup_lists_resume_all_before_my_tabs(home):
    code, out = run(home, "setup.py")
    lines = [ln.split()[0] for ln in out.splitlines() if ln.strip()]
    assert "resume-all" in lines and lines.index("resume-all") < lines.index("my-tabs")


# ---- my-tabs 패치 ----

FAKE_TABS = "\n".join([
    'import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";',
    "const stop = (_e, cx) => cx.stop_propagation();",
    "export default class Tabs extends View {",
    "  render() {",
    "    const t = theme();",
    "    return h_flex().size_full().min_w(0).px(10)",
    '      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))',
    "      ;",
    "  }",
    "}",
    "",
])


def test_resume_patches_only_when_mod_exists(tmp_path, monkeypatch):
    monkeypatch.setattr(tabs, "mod_js", lambda name: str(tmp_path / name / "main.js"))
    assert not any(p in tabs.patches() for p in tabs.RESUME_PATCHES)
    (tmp_path / "resume-all").mkdir()
    (tmp_path / "resume-all" / "main.js").write_text("//", encoding="utf-8")
    assert all(p in tabs.patches() for p in tabs.RESUME_PATCHES)


def test_resume_patches_place_button_and_import():
    out = ensure_imports(apply_patches(FAKE_TABS, tabs.RESUME_PATCHES, "tabs"), ("terminals",))
    lines = out.splitlines()
    assert 'settings, terminals } from "herdr";' in lines[0]
    assert out.index("function resumableCount()") < out.index("export default class Tabs")
    button = next(i for i, ln in enumerate(lines) if ln.strip() == ".child(resumeButton())")
    assert "Files" in lines[button + 1]  # Files 바로 왼쪽
    assert out.index("const resumeButton") < out.index("return h_flex().size_full()")
    assert 'mod: "resume-all", kind: "dialog"' in out


def test_import_not_doubled_when_original_has_terminals():
    src = FAKE_TABS.replace("settings }", "settings, terminals }")
    out = ensure_imports(src, ("terminals",))
    assert out.count("terminals") == 1


@pytest.mark.skipif(not NODE, reason="node 없음")
def test_patched_fake_and_main_parse(tmp_path):
    out = ensure_imports(apply_patches(FAKE_TABS, tabs.RESUME_PATCHES, "tabs"), ("terminals",))
    for name, text in (("tabs.mjs", out), ("main.mjs", read_main())):
        p = tmp_path / name
        p.write_text(text, encoding="utf-8")
        r = subprocess.run([NODE, "--check", str(p)], capture_output=True, text=True, timeout=30)
        assert r.returncode == 0, (name, r.stderr)


# ---- 두 곳의 후보 규칙이 같아야 함 (SKILL.md 2-4 함정) ----

def rule_of(js: str, fn: str) -> str:
    m = re.search(r"function %s\(\) \{\n(.*?)\n\}" % fn, js, re.S)
    assert m, fn
    body = re.sub(r"\bRESUME_(SESSION_RE|PROJECT_RE)\b", r"\1", m.group(1))
    return re.sub(r"\)(\.length)?;$", ");", re.sub(r"\s+", " ", body).strip())


def test_candidate_rule_matches_popup():
    assert rule_of(tabs.RESUME_JS, "resumableCount") == rule_of(read_main(), "resumableTerminals")
    for const in ("SESSION_RE", "PROJECT_RE"):
        pat = re.compile(r"const (?:RESUME_)?%s = (.*);" % const)
        assert pat.search(tabs.RESUME_JS).group(1) == pat.search(read_main()).group(1)


# ---- 이어하기 줄 (main.js 의 resumeLine 을 떼어 node 로) ----

def resume_line_js() -> str:
    src = read_main()
    parts = [re.search(r"^const %s = .*;$" % n, src, re.M).group(0) for n in ("MODES", "slug", "samePath", "isCmd")]
    fn = re.search(r"^export function resumeLine\(row\) \{\n.*?^\}$", src, re.S | re.M).group(0)
    return "\n".join(parts + [fn.replace("export ", "")])


SID = "0123abcd-0000-1111-2222-333344445555"
CASES = [
    # 같은 폴더 + bypass 한 번이라도 → 플래그만
    ({"cwd": r"C:\work\proj", "project": "C--work-proj", "shell": "powershell.exe",
      "info": {"cwd": r"C:\work\proj", "bypass": True, "mode": "default"}},
     "claude --resume %s --dangerously-skip-permissions" % SID),
    # 셸이 다른 폴더 → 기록의 시작 폴더로 옮김(작은따옴표는 두 번)
    ({"cwd": r"C:\Users\me", "project": "C--work-it-s", "shell": "pwsh",
      "info": {"cwd": r"C:\work\it's", "mode": "plan"}},
     "Set-Location -LiteralPath 'C:\\work\\it''s'; claude --resume %s --permission-mode plan" % SID),
    # cmd 셸
    ({"cwd": r"C:\Users\me", "project": "C--work-proj", "shell": r"C:\Windows\System32\cmd.exe",
      "info": {"cwd": r"C:\work\proj", "mode": "acceptEdits"}},
     'cd /d "C:\\work\\proj" && claude --resume %s --permission-mode acceptEdits' % SID),
    # 셸 폴더가 기록 폴더 이름과 맞으면(대소문자·끝 \ 다름) 안 옮김, default 는 옵션 없음
    ({"cwd": "c:\\work\\proj\\", "project": "c--work-proj-", "shell": "powershell",
      "info": {"cwd": r"C:\work\proj", "mode": "default"}},
     "claude --resume %s" % SID),
]


@pytest.mark.skipif(not NODE, reason="node 없음")
def test_resume_line():
    rows = [{**row, "session": SID} for row, _ in CASES]
    script = resume_line_js() + "\nconsole.log(JSON.stringify(%s.map(resumeLine)));" % json.dumps(rows)
    r = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == [want for _, want in CASES]


# ---- 삭제 = 세션 이름표 두 개 지우기 (main.js 의 forgetArgs 를 떼어 node 로) ----

@pytest.mark.skipif(not NODE, reason="node 없음")
def test_forget_args_clear_both_labels():
    fn = re.search(r"^export function forgetArgs\(address\) \{\n.*?^\}$", read_main(), re.S | re.M).group(0)
    script = fn.replace("export ", "") + '\nconsole.log(JSON.stringify(forgetArgs("t7")));'
    r = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == ["label", "t7", "claude.session=", "claude.project="]


def test_forget_button_does_not_toggle_row():
    src = read_main()
    btn = re.search(r"^  forgetButton\(r\) \{\n.*?^  \}$", src, re.S | re.M).group(0)
    assert 'on_mouse_down("left", (_e, cx) => cx.stop_propagation())' in btn
    assert "cx.stop_propagation(); if (enabled) this.forget(r, cx);" in btn
