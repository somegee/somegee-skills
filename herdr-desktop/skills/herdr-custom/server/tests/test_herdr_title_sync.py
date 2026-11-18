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


# ---- 빈 공간 남기기 ----

def _tab(tab_id, *terminals):
    return {"id": tab_id, "name": "", "root": {"children": [{"content": {"terminal": x}} for x in terminals]}}


def _doc(*spaces):
    return {"spaces": list(spaces)}


SP_A = {"id": "a", "name": "개발", "folder": "/w", "tabs": [_tab("t1", "t3"), _tab("t2", "t4")]}
SP_B = {"id": "b", "name": "일상", "folder": "/d", "tabs": [_tab("t3", "t5")]}
SP_B_EMPTY = {"id": "b", "name": "일상", "folder": "/d", "tabs": []}


def _plan(doc, seen_doc, pending=None, live=(), now=0.0, machine=None):
    return ts.plan_restores(doc, machine, ts.snapshot_spaces(seen_doc, machine), pending or {}, set(live), now)


def test_space_closed_with_its_last_tab_comes_back_empty_in_place():
    restores, pending = _plan(_doc(SP_A), _doc(SP_B, SP_A), live={"t3", "t4"})  # t5 는 죽음
    assert restores == [{"space": SP_B_EMPTY, "index": 0}] and list(pending) == ["b"]
    value = ts.apply_restores(_doc(SP_A), restores)
    assert [(s["id"], len(s["tabs"])) for s in value["spaces"]] == [("b", 0), ("a", 2)]
    assert len(SP_B["tabs"]) == 1  # 원본은 그대로
    # 문서에 다시 보이면 지켜보기를 끝낸다
    again, pending = ts.plan_restores(value, None, ts.snapshot_spaces(_doc(SP_A), None), pending, {"t3", "t4"}, 3.0)
    assert again == [] and pending == {}


def test_not_restored_when_many_tabs_or_already_empty_or_unnamed():
    assert _plan(_doc(SP_B), _doc(SP_A, SP_B))[0] == []  # 탭 2개 공간을 통째로 닫음
    assert _plan(_doc(SP_A), _doc(SP_A, SP_B_EMPTY))[0] == []  # 비어 있던 공간을 지움
    unnamed = {**SP_B, "name": ""}
    assert _plan(_doc(SP_A), _doc(SP_A, unnamed))[0] == []


def test_space_deleted_but_session_kept_is_left_alone_after_waiting():
    # 웹 휴지통: 공간만 지우고 세션(t5)은 살아 있는데 어느 공간에도 없다
    restores, pending = _plan(_doc(SP_A), _doc(SP_A, SP_B), live={"t3", "t4", "t5"}, now=100.0)
    assert restores == [] and list(pending) == ["b"]
    seen = ts.snapshot_spaces(_doc(SP_A), None)
    restores, pending = ts.plan_restores(_doc(SP_A), None, seen, pending, {"t3", "t4", "t5"}, 100.0 + ts.KEEP_WAIT_SECONDS + 1)
    assert restores == [] and pending == {}


def test_last_session_dragged_to_another_space_leaves_source_empty():
    # 옮기는 중: t5 가 살아 있고 아직 어디에도 없다 → 지켜본다
    _, pending = _plan(_doc(SP_A), _doc(SP_A, SP_B), live={"t3", "t4", "t5"}, now=0.0)
    moved = {**SP_A, "tabs": [*SP_A["tabs"], _tab("t9", "t5")]}
    restores, _ = ts.plan_restores(_doc(moved), None, ts.snapshot_spaces(_doc(SP_A), None), pending, {"t3", "t4", "t5"}, 3.0)
    assert [r["space"]["id"] for r in restores] == ["b"]


def test_remote_machine_uses_qualified_addresses():
    restores, _ = _plan(_doc(SP_A), _doc(SP_A, SP_B), live={"pc/t5"}, machine="pc")
    assert restores == []  # pc/t5 가 살아 있고 어디에도 없다 → 아직
    restores, _ = _plan(_doc(SP_A), _doc(SP_A, SP_B), live={"t5"}, machine="pc")  # 서버의 t5 는 다른 터미널
    assert [r["space"]["id"] for r in restores] == ["b"]


def test_apply_restores_skips_existing_and_clamps_index():
    value = ts.apply_restores(_doc(SP_A), [{"space": SP_B_EMPTY, "index": 9}, {"space": {**SP_A, "tabs": []}, "index": 0}])
    assert [s["id"] for s in value["spaces"]] == ["a", "b"] and len(value["spaces"][0]["tabs"]) == 2


def test_keep_spaces_writes_doc_and_skips_rename_this_tick(monkeypatch):
    calls = []
    docs = [{"value": _doc(SP_B, SP_A), "version": 5}, {"value": _doc(SP_A), "version": 6}]

    def fake(batch):
        calls.extend(batch)
        return [{"result": docs.pop(0)} if m == "doc.get" else {"result": {}} for m, _ in batch]

    monkeypatch.setattr(ts, "call_api", fake)
    sync = ts.TitleSync()
    sync.sync_machine(None, {}, {"t3", "t4"})  # 처음 봄 — 기억만
    sync.sync_machine(None, {}, {"t3", "t4"})  # 일상이 사라졌고 t5 는 죽음
    sets = [p for m, p in calls if m == "doc.set"]
    assert len(sets) == 1 and sets[0]["version"] == 6
    assert [(s["id"], len(s["tabs"])) for s in sets[0]["value"]["spaces"]] == [("b", 0), ("a", 2)]
