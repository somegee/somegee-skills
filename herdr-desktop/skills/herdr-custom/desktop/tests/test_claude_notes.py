"""claude-notes — 설치(오른쪽 패널 칸)·제거, my-tabs Notes 버튼 패치, mod 의 순수 함수.

  python -m pytest herdr-desktop/skills/herdr-custom/desktop/tests/test_claude_notes.py
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
MAIN_JS = os.path.join(DESKTOP, "assets", "claude-notes", "main.js")
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, HERE)
import featurelib as fl  # noqa: E402
import install_tabs_agent_name as tabs  # noqa: E402
from patchlib import apply_patches  # noqa: E402
from test_feature_status import run, tree  # noqa: E402

NODE = shutil.which("node")
PANEL_LAYOUT = {"root": {"type": "row", "children": [
    {"id": "main", "type": "block", "content": {"mod": "pane"}},
    {"id": "panel", "type": "column", "hidden": True, "children": [
        {"id": "panel-body", "type": "stack", "active": "files", "children": [
            {"id": "files", "type": "block", "content": {"mod": "files"}},
            {"id": "changes", "type": "block", "content": {"mod": "changes"}},
        ]},
    ]},
    {"id": "status", "type": "block", "size": {"px": 24}, "content": {"mod": "status"}},
]}}


@pytest.fixture
def home(tmp_path):
    h = tmp_path / "herdr-app"
    (h / "layouts").mkdir(parents=True)
    (h / "mods").mkdir()
    (h / "shared.json").write_text(json.dumps({"layout": "my-main"}), encoding="utf-8")
    (h / "layouts" / "my-main.json").write_text(json.dumps(PANEL_LAYOUT, indent=2), encoding="utf-8")
    (h / "keys.json").write_text(json.dumps({"global": {}, "terminal": {}}, indent=2), encoding="utf-8")
    return h


def stack_ids(home):
    layout = json.loads((home / "layouts" / "my-main.json").read_text(encoding="utf-8"))
    return [c["id"] for c in layout["root"]["children"][1]["children"][0]["children"]]


def test_install_puts_one_panel_slot_then_remove(home):
    assert run(home, "install_claude_notes.py", "--status")[0] == fl.EXIT_CODES[fl.MISSING]
    code, out = run(home, "install_claude_notes.py")
    assert code == 0 and "바뀜 → 최신" in out, out
    assert sorted(os.listdir(home / "mods" / "claude-notes")) == ["main.js", "mod.json", "notes.svg"]
    assert stack_ids(home) == ["claude-notes", "files", "changes"]

    before = tree(home)
    code, out = run(home, "install_claude_notes.py")
    assert code == 0 and "변경 없음" in out, out
    assert tree(home) == before

    code, out = run(home, "install_claude_notes.py", "--remove")
    assert code == 0, out
    assert not (home / "mods" / "claude-notes").exists()
    assert stack_ids(home) == ["files", "changes"]


def test_slot_outside_panel_is_moved_in(home):
    layout = json.loads((home / "layouts" / "my-main.json").read_text(encoding="utf-8"))
    layout["root"]["children"].append({"id": "x1", "type": "block", "size": {"px": 320}, "content": {"mod": "claude-notes"}})
    (home / "layouts" / "my-main.json").write_text(json.dumps(layout), encoding="utf-8")
    code, out = run(home, "install_claude_notes.py")
    assert code == 0, out
    after = json.loads((home / "layouts" / "my-main.json").read_text(encoding="utf-8"))
    assert [c["id"] for c in after["root"]["children"]] == ["main", "panel", "status"]
    assert stack_ids(home)[0] == "claude-notes"


def test_layout_without_panel_stops_with_message(home):
    plain = {"root": {"type": "column", "children": [{"id": "status", "type": "block", "content": {"mod": "status"}}]}}
    (home / "layouts" / "my-main.json").write_text(json.dumps(plain), encoding="utf-8")
    code, out = run(home, "install_claude_notes.py")
    assert code != 0 and "오른쪽 패널" in out, out


def test_setup_lists_claude_notes_before_my_tabs(home):
    _code, out = run(home, "setup.py")
    names = [ln.split()[0] for ln in out.splitlines() if ln.strip()]
    assert names.index("claude-notes") < names.index("my-tabs")


FAKE_TABS = "\n".join([
    "    return h_flex().size_full().min_w(0).px(10)",
    '      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))',
    "",
])


def test_notes_patch_only_when_mod_exists(tmp_path, monkeypatch):
    monkeypatch.setattr(tabs, "mod_js", lambda name: str(tmp_path / name / "main.js"))
    assert not any(p in tabs.patches() for p in tabs.NOTES_PATCHES)
    (tmp_path / "claude-notes").mkdir()
    (tmp_path / "claude-notes" / "main.js").write_text("//", encoding="utf-8")
    assert all(p in tabs.patches() for p in tabs.NOTES_PATCHES)


def test_notes_button_sits_left_of_files_with_resume():
    out = apply_patches(FAKE_TABS, tabs.RESUME_PATCHES[2:] + tabs.NOTES_PATCHES, "tabs")
    lines = [ln.strip() for ln in out.splitlines()]
    i = lines.index('.child(panelButton("claude-notes", "Notes", "mods/claude-notes/notes.svg"))')
    assert lines[i - 1] == ".child(resumeButton())" and "Files" in lines[i + 1]


def mod_pure_source():
    with open(MAIN_JS, encoding="utf-8") as f:
        src = f.read().split("// ---- 읽기 ----")[0]
    src = re.sub(r"^import .*$", "", src, flags=re.M)
    return src.replace("export ", "").replace("const checking =", "const _checking =")


@pytest.mark.skipif(not NODE, reason="node 없음")
def test_mod_pure_functions(tmp_path):
    script = "const herdrApi = {};\n" + mod_pure_source() + "\n".join([
        "console.log(JSON.stringify({",
        "  remote: splitAddress('server/t12'), local: splitAddress('t65'),",
        "  home: homeFromAppHome('C:\\\\Users\\\\u\\\\.config\\\\herdr-app'),",
        "  p1: dataPath('sessions/x.json', null, 'C:\\\\u'), p2: dataPath('_all.json', 'server', null),",
        "  c1: noteCandidates('a', JSON.stringify({file: 'w-proj.json'})), c2: noteCandidates('a', null),",
        "  bad: noteCandidates('a', JSON.stringify({file: '../../x.json'})),",
        "  tabs: orderTabs(parseBook(JSON.stringify({tabs: [",
        "    {title: 'old', session: {id: 'a'}, items: [], updatedAt: '2026-01-01T00:00:00Z'},",
        "    {title: 'other', session: {id: 'b'}, items: [], updatedAt: '2026-03-01T00:00:00Z'},",
        "    {title: 'new', session: {id: 'a'}, items: [{text: 'x', isDone: true}], updatedAt: '2026-02-01T00:00:00Z'}]})), 'a'),",
        "}));",
    ])
    p = tmp_path / "pure.mjs"
    p.write_text(script, encoding="utf-8")
    r = subprocess.run([NODE, str(p)], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    got = json.loads(r.stdout)
    assert got["remote"] == {"machine": "server", "id": "t12"} and got["local"] == {"machine": None, "id": "t65"}
    assert got["home"] == "C:\\Users\\u"
    assert got["p1"] == "C:\\u\\.claude\\notes-data\\sessions\\x.json" and got["p2"] == ".claude/notes-data/_all.json"
    assert got["c1"] == ["w-proj.json"] and got["c2"] == got["bad"] == ["sessions/a.json", "_all.json"]
    assert [t["title"] for t in got["tabs"]["mine"]] == ["new", "old"] and [t["title"] for t in got["tabs"]["others"]] == ["other"]


@pytest.mark.skipif(not NODE, reason="node 없음")
def test_mod_parses(tmp_path):
    p = tmp_path / "main.mjs"
    shutil.copy(MAIN_JS, p)
    r = subprocess.run([NODE, "--check", str(p)], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
