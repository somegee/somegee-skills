import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("label_session", Path(__file__).parent.parent / "label_session.py")
label_session = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(label_session)

SID = "d87e042f-285f-454f-bbcd-a9116cb29879"


def test_labels_from_windows_transcript_path():
    event = {"session_id": SID, "transcript_path": f"C:\\Users\\me\\.claude\\projects\\C--Users-me-Desktop\\{SID}.jsonl"}
    # Path 는 실행 OS 기준이라 윈도우 경로를 리눅스에서 읽으면 통째로 이름 하나가 된다 → '/' 경로도 따로 시험
    labels = label_session.labels_from({**event, "transcript_path": f"/home/me/.claude/projects/-home-me-ws/{SID}.jsonl"})
    assert labels == [f"claude.session={SID}", "claude.project=-home-me-ws"]


def test_labels_from_rejects_bad_session_id():
    assert label_session.labels_from({"session_id": "x; rm -rf /", "transcript_path": "/a/b/c.jsonl"}) is None


def test_labels_from_rejects_odd_project_folder():
    event = {"session_id": SID, "transcript_path": f"/home/me/.claude/projects/bad name$/{SID}.jsonl"}
    assert label_session.labels_from(event) is None


def test_labels_from_requires_transcript():
    assert label_session.labels_from({"session_id": SID}) is None


def test_main_outside_herdr_does_nothing(monkeypatch):
    monkeypatch.delenv("HC_TERMINAL_ID", raising=False)
    called = []
    monkeypatch.setattr(label_session.subprocess, "run", lambda *a, **k: called.append(a))
    assert label_session.main() == 0
    assert called == []
