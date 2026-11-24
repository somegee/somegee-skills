"""덧붙이기(addons) — 복제본을 다시 만들어도 각자 덧붙인 버튼·패치가 지켜지는지, 못 거는 것은 빼고 계속하는지.

  python -m pytest herdr-desktop/skills/herdr-custom/desktop/tests/test_addons.py
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))
sys.path.insert(0, HERE)
import addons  # noqa: E402
import install_tabs_agent_name as tabs  # noqa: E402
import patchlib  # noqa: E402
from patchlib import apply_patches  # noqa: E402
from test_resume_all import FAKE_TABS  # noqa: E402

NODE = shutil.which("node")


@pytest.fixture
def addon_dir(tmp_path, monkeypatch):
    d = tmp_path / "addons"
    d.mkdir()
    monkeypatch.setattr(addons, "ADDON_DIR", str(d))
    monkeypatch.setattr(addons, "mod_exists", lambda name: name != "missing-mod")
    monkeypatch.setattr(addons, "icon_exists", lambda icon: "missing" not in icon)
    return d


def put(d, name, data):
    (d / (name + ".json")).write_text(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False), encoding="utf-8")


BUTTON = {"tabs_button": {"mod": "my-popup", "label": "OAuth", "icon": "mods/my-popup/key.svg", "width": 540, "height": 660}}


def test_no_addons_changes_nothing(addon_dir):
    assert addons.apply(FAKE_TABS, "my-tabs") == (FAKE_TABS, [])


def test_tabs_button_goes_left_of_files(addon_dir):
    put(addon_dir, "my-popup", BUTTON)
    out, report = addons.apply(FAKE_TABS, "my-tabs")
    assert report == [("my-popup", "")]
    lines = [ln.strip() for ln in out.splitlines()]
    i = lines.index(".child(addonButton_my_popup())")
    assert "Files" in lines[i + 1]
    assert 'mod: "my-popup", kind: "dialog", width: 540, height: 660' in out
    assert out.index("const addonButton_my_popup") < out.index("return h_flex().size_full()")


def test_tabs_button_only_for_my_tabs(addon_dir):
    put(addon_dir, "my-popup", BUTTON)
    assert addons.apply(FAKE_TABS, "my-spaces") == (FAKE_TABS, [])


def test_button_with_resume_keeps_order(addon_dir):
    put(addon_dir, "my-popup", BUTTON)
    out, _ = addons.apply(apply_patches(FAKE_TABS, tabs.RESUME_PATCHES, "tabs"), "my-tabs")
    lines = [ln.strip() for ln in out.splitlines()]
    i = lines.index(".child(resumeButton())")
    assert lines[i + 1] == ".child(addonButton_my_popup())" and "Files" in lines[i + 2]


def test_missing_mod_is_skipped_others_kept(addon_dir):
    put(addon_dir, "a-gone", {"tabs_button": {**BUTTON["tabs_button"], "mod": "missing-mod"}})
    put(addon_dir, "b-ok", BUTTON)
    out, report = addons.apply(FAKE_TABS, "my-tabs")
    assert report[0][0] == "a-gone" and "없음" in report[0][1]
    assert report[1] == ("b-ok", "")
    assert "addonButton_b_ok" in out and "missing-mod" not in out


def test_bad_patch_is_skipped_not_fatal(addon_dir):
    put(addon_dir, "a-bad", {"patches": {"my-tabs": [["이 문장은 원본에 없음", "x"]]}})
    put(addon_dir, "b-good", {"patches": {"my-tabs": [["const t = theme();", "const t = theme(); // 덧붙임"]]}})
    out, report = addons.apply(FAKE_TABS, "my-tabs")
    assert report[0][0] == "a-bad" and report[0][1]
    assert report[1] == ("b-good", "")
    assert "// 덧붙임" in out


def test_bad_patch_does_not_half_apply(addon_dir):
    put(addon_dir, "half", {"patches": {"my-tabs": [["const t = theme();", "const t = theme(); // 1"], ["없는 문장", "x"]]}})
    out, report = addons.apply(FAKE_TABS, "my-tabs")
    assert out == FAKE_TABS and report[0][1]  # 한 덧붙이기는 다 걸리거나 하나도 안 걸림


@pytest.mark.parametrize("data", [
    "{not json",
    "[1, 2]",
    {"tabs_button": {"mod": "Bad Name", "label": "x"}},
    {"tabs_button": {"mod": "my-popup", "label": ""}},
    {"tabs_button": {"mod": "my-popup", "label": "x" * 21}},
    {"tabs_button": {"mod": "my-popup", "label": "x", "icon": "../../evil.svg"}},
    {"tabs_button": {"mod": "my-popup", "label": "x", "width": 99999}},
    {"patches": {"my-tabs": "not a list"}},
    {"patches": {"my-tabs": [["only one"]]}},
])
def test_invalid_addons_reported_once(addon_dir, data):
    put(addon_dir, "x", data)
    assert addons.load()[0][0] == "x" and addons.load()[0][2]  # 못 읽음·형식 오류는 load 에서 한 번
    for clone in addons.CLONES:
        assert addons.apply(FAKE_TABS, clone) == (FAKE_TABS, [])  # 복제본마다 되풀이해 알리지 않음


@pytest.mark.parametrize("data, word", [
    ({"tabs_buton": {"mod": "my-popup", "label": "x"}}, "모르는 항목"),
    ({"patches": {"my-tab": [["a", "b"]]}}, "복제본 이름"),
    ({"patches": [["a", "b"]]}, "patches"),
    ({"tabs_button": {"mod": "tabs", "label": "x"}}, "기본"),
    ({}, "없음"),
])
def test_typos_are_not_silently_ignored(addon_dir, data, word):
    put(addon_dir, "x", data)
    assert word in addons.load()[0][2]


def test_empty_replacement_deletes(addon_dir):
    put(addon_dir, "cut", {"patches": {"my-tabs": [["    const t = theme();\n", ""]]}})
    out, report = addons.apply(FAKE_TABS, "my-tabs")
    assert report == [("cut", "")] and "const t = theme();" not in out


def test_missing_icon_is_reported(addon_dir):
    put(addon_dir, "x", {"tabs_button": {**BUTTON["tabs_button"], "icon": "mods/my-popup/missing.svg"}})
    out, report = addons.apply(FAKE_TABS, "my-tabs")
    assert out == FAKE_TABS and "아이콘" in report[0][1]


def test_desired_clone_changes_when_addon_changes(addon_dir, tmp_path, monkeypatch):
    """덧붙이기 파일이 바뀌면 원하는 복제본 내용이 바뀐다 → 상태가 '낡음'으로 잡혀 다시 만든다."""
    (tmp_path / "mods" / "tabs").mkdir(parents=True)
    (tmp_path / "mods" / "tabs" / "main.js").write_text(FAKE_TABS, encoding="utf-8")
    monkeypatch.setattr(patchlib, "mod_js", lambda name: str(tmp_path / "mods" / name / "main.js"))
    plain = patchlib.desired_clone("tabs", "my-tabs", lambda s: s)
    put(addon_dir, "my-popup", BUTTON)
    with_button = patchlib.desired_clone("tabs", "my-tabs", lambda s: s)
    (addon_dir / "my-popup.json").unlink()
    assert plain != with_button and patchlib.desired_clone("tabs", "my-tabs", lambda s: s) == plain


def test_bad_file_name_reported(addon_dir):
    put(addon_dir, "Bad_Name", BUTTON)
    assert addons.load()[0][2]


@pytest.mark.skipif(not NODE, reason="node 없음")
def test_label_cannot_break_out_of_js(addon_dir, tmp_path):
    put(addon_dir, "evil", {"tabs_button": {"mod": "my-popup", "label": '"); x(); ("'}})
    out, _ = addons.apply(FAKE_TABS, "my-tabs")
    assert '.child("\\"); x(); (\\"")' in out
    p = tmp_path / "t.mjs"
    p.write_text(out, encoding="utf-8")
    r = subprocess.run([NODE, "--check", str(p)], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr


def test_anchors_match_my_tabs_installer():
    assert addons.TABS_FILES_ANCHOR == tabs.FILES_BUTTON
    assert any(old == addons.TABS_RENDER_ANCHOR for old, _ in tabs.RESUME_PATCHES)


def test_desired_clone_includes_addons(addon_dir, tmp_path, monkeypatch):
    base = tmp_path / "mods" / "tabs"
    base.mkdir(parents=True)
    (base / "main.js").write_bytes(FAKE_TABS.replace("\n", "\r\n").encode("utf-8"))
    monkeypatch.setattr(patchlib, "mod_js", lambda name: str(tmp_path / "mods" / name / "main.js"))
    put(addon_dir, "my-popup", BUTTON)
    new = patchlib.desired_clone("tabs", "my-tabs", lambda s: s).decode("utf-8")
    assert "addonButton_my_popup" in new and "\r\n" in new  # 원본 줄바꿈(CRLF) 유지
    monkeypatch.setitem(patchlib.BUILDERS, "my-tabs", ("tabs", lambda s: s))
    assert patchlib.desired_clone_report("my-tabs") == [("my-popup", "")]
