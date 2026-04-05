#!/usr/bin/env python3
"""Terminal Swarm Hook Relay — stdin JSON을 데몬 HTTP 엔드포인트로 전달.

Claude Code command hook에서 호출되며, 데몬이 꺼져 있으면 조용히 종료한다.
"""
import sys
import urllib.request
import urllib.error

ENDPOINT = "http://localhost:7890/hooks/claude-state"
TIMEOUT = 3


def main():
    try:
        data = sys.stdin.buffer.read()
        req = urllib.request.Request(
            ENDPOINT,
            data=data,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=TIMEOUT)
    except (urllib.error.URLError, OSError, Exception):
        # 데몬 미실행(connection refused) 등 모든 에러를 조용히 무시
        pass


if __name__ == "__main__":
    main()
