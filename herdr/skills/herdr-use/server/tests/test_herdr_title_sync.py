import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import herdr_title_sync as ts  # noqa: E402


def doc(*tabs):
    return {"spaces": [{"id": "sp1", "name": "서버1", "tabs": list(tabs)}]}


def tab(tab_id, name, *terminals):
    return {"id": tab_id, "name": name,
            "root": {"type": "row", "children": [{"content": {"terminal": t}} for t in terminals]}}


def test_clean_title_strips_progress_marks():
    assert ts.clean_title("✳ 기술조사") == "기술조사"
    assert ts.clean_title(None) == ""


def test_unnamed_tab_takes_title_at_once():
    renames, seen = ts.plan_renames(doc(tab("a", "", "t9")), None, {"t9": "교통편"}, {})
    assert renames == {"a": "교통편"} and seen == {"t9": "교통편"}


def test_named_tab_only_follows_changes():
    d = doc(tab("a", "서버세션1", "t3"))
    assert ts.plan_renames(d, None, {"t3": "기술조사"}, {})[0] == {}
    assert ts.plan_renames(d, None, {"t3": "기술조사"}, {"t3": "기술조사"})[0] == {}
    assert ts.plan_renames(d, None, {"t3": "새이름"}, {"t3": "기술조사"})[0] == {"a": "새이름"}


def test_skips_default_titles_and_multi_claude_tabs():
    assert ts.plan_renames(doc(tab("a", "", "t1")), None, {"t1": "Claude Code"}, {})[0] == {}
    assert ts.plan_renames(doc(tab("a", "", "t1", "t2")), None, {"t1": "x", "t2": "y"}, {})[0] == {}


def test_remote_machine_addresses_are_qualified():
    renames, _ = ts.plan_renames(doc(tab("a", "", "t14")), "pc", {"pc/t14": "3d모델링"}, {})
    assert renames == {"a": "3d모델링"}


def test_apply_renames_does_not_mutate():
    d = doc(tab("a", "", "t9"), tab("b", "x", "t3"))
    out = ts.apply_renames(d, {"a": "새"})
    assert [t["name"] for t in out["spaces"][0]["tabs"]] == ["새", "x"]
    assert d["spaces"][0]["tabs"][0]["name"] == ""


def test_claude_titles_only_live_claude():
    ts_list = [
        {"address": "t1", "state": "live", "status": {"app": "claude-code"}, "title": "✳ a"},
        {"address": "t2", "state": "finished", "status": {"app": "claude-code"}, "title": "b"},
        {"address": "t3", "state": "live", "status": None, "title": "bash"},
    ]
    assert ts.claude_titles(ts_list) == {"t1": "a"}
