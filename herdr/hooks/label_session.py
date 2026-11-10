"""SessionStart 훅: herdr 터미널 안에서 Claude 세션이 시작되면(새로·/clear·resume) 그 터미널에 세션 이름표를 단다.

    claude.session = <세션 id>       예: d87e042f-285f-454f-bbcd-a9116cb29879
    claude.project = <기록 폴더 이름> 예: C--Users-----Desktop-projects

웹 관제 화면이 이 두 값으로 `~/.claude/projects/<project>/<session>.jsonl`(대화 기록)을 찾는다.
herdr 밖(HC_TERMINAL_ID 없음)이면 아무것도 안 한다. 어떤 실패도 세션을 막지 않게 항상 0으로 끝낸다.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

SESSION_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
PROJECT_RE = re.compile(r"[A-Za-z0-9_-]{1,200}")
TERMINAL_RE = re.compile(r"t[0-9a-z]{1,7}")
HC_TIMEOUT_SECONDS = 5


def labels_from(event: dict) -> list[str] | None:
    """훅 입력 → hc label 인자. 값이 이상하면 None."""
    session = event.get("session_id")
    transcript = event.get("transcript_path")
    if not isinstance(session, str) or not SESSION_RE.fullmatch(session):
        return None
    if not isinstance(transcript, str) or not transcript:
        return None
    project = Path(transcript).parent.name
    if not PROJECT_RE.fullmatch(project):
        return None
    return [f"claude.session={session}", f"claude.project={project}"]


def find_hc() -> str | None:
    found = shutil.which("hc")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "hc"
    return str(fallback) if fallback.exists() else None


def main() -> int:
    terminal = os.environ.get("HC_TERMINAL_ID", "")
    if not TERMINAL_RE.fullmatch(terminal):
        return 0
    try:
        event = json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return 0
    labels = labels_from(event) if isinstance(event, dict) else None
    hc = find_hc()
    if not labels or not hc:
        return 0
    try:
        subprocess.run([hc, "label", terminal, *labels], timeout=HC_TIMEOUT_SECONDS,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    except (OSError, subprocess.SubprocessError):
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
