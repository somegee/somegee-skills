#!/usr/bin/env python3
"""herdr 탭 이름을 Claude 세션 이름(/rename)에 맞춘다 — 서버에서 상주 (systemd --user herdr-title-sync).

Claude 는 /rename 이름을 창 제목으로 내보내고, 서버 herdr-core 는 서버·PC 터미널 제목을 한 목록으로 갖는다.
데스크톱 앱 사이드바는 머신마다 엔진 문서 `herdr-app`(spaces → tabs → root … content.terminal)로 그리므로,
여기서 그 문서의 탭 이름만 바꾸면 앱이 열려 있든 닫혀 있든, 앱이 업데이트돼도 이름이 따라간다.
(예전 PC 앱 mod 방식은 앱이 시작할 때 고친 main.json 을 원래대로 되돌려 꺼졌다 — 2026-11-03)

규칙(옛 title-sync mod 와 같음)
- 이름 없던 탭(name "")은 처음 보자마자 제목으로.
- 이름 붙은 탭은 제목이 **바뀔 때만** 따라 바꾼다(직접 붙인 이름을 시작하자마자 덮지 않게).
- Claude 창이 둘 이상인 탭, 「Claude Code」 같은 기본 제목은 건드리지 않는다.
- 문서는 version 을 맞춰 쓰므로 앱이 그 사이 바꿨으면(conflict) 다음 차례에 다시 한다.

표준 라이브러리만 쓴다. 실행: python3 herdr_title_sync.py [--once] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import time
from typing import Any

APP_DOC = "herdr-app"
CHECK_SECONDS = 3.0
HC_TIMEOUT_SECONDS = 15.0
CLAUDE_APP = "claude-code"
IGNORED_TITLES = frozenset({"", "claude code", "claude"})
MAX_TITLE_CHARS = 80
# Claude 가 제목 앞에 붙이는 진행 표시(✳, 점자 스피너 등)
LEADING_MARKS = re.compile(r"^[^\w]+", re.UNICODE)
HC = os.environ.get("HERDR_HC", os.path.expanduser("~/.local/bin/hc"))

log = logging.getLogger("herdr-title-sync")


# ---- 순수 함수 ----

def clean_title(raw: Any) -> str:
    text = LEADING_MARKS.sub("", raw if isinstance(raw, str) else "").strip()
    return text[:MAX_TITLE_CHARS]


def qualify(machine: str | None, local: str) -> str:
    """그 머신 문서 속 주소(`t14`) → 서버 목록 주소(`pc/t14`). 서버면 그대로."""
    return local if machine is None else f"{machine}/{local}"


def tab_terminals(node: Any) -> list[str]:
    """탭 구성 나무 안의 터미널 주소(그 머신 기준)."""
    if not isinstance(node, dict):
        return []
    found: list[str] = []
    content = node.get("content")
    if isinstance(content, dict) and isinstance(content.get("terminal"), str):
        found.append(content["terminal"])
    for child in node.get("children") or []:
        found.extend(tab_terminals(child))
    return found


def claude_titles(terminals: list[dict[str, Any]]) -> dict[str, str]:
    """살아 있는 Claude 터미널 → 다듬은 제목."""
    out: dict[str, str] = {}
    for t in terminals:
        status = t.get("status")
        app = status.get("app") if isinstance(status, dict) else None
        if t.get("state") == "live" and app == CLAUDE_APP and isinstance(t.get("address"), str):
            out[t["address"]] = clean_title(t.get("title"))
    return out


def plan_renames(
    doc_value: Any, machine: str | None, titles: dict[str, str], prev: dict[str, str]
) -> tuple[dict[str, str], dict[str, str]]:
    """(바꿀 탭 {tab id: 새 이름}, 이번에 본 제목 {주소: 제목}).

    prev 는 지난번에 본 제목(아직 못 본 주소는 없음). 원본은 건드리지 않는다.
    """
    renames: dict[str, str] = {}
    observed: dict[str, str] = {}
    spaces = doc_value.get("spaces") if isinstance(doc_value, dict) else None
    for space in spaces if isinstance(spaces, list) else []:
        for tab in (space.get("tabs") if isinstance(space, dict) else None) or []:
            if not isinstance(tab, dict) or not isinstance(tab.get("id"), str):
                continue
            claude = [a for a in (qualify(machine, x) for x in tab_terminals(tab.get("root"))) if a in titles]
            if len(claude) != 1:
                continue  # Claude 창이 없거나 여럿인 탭은 건드리지 않는다
            address = claude[0]
            title = titles[address]
            observed[address] = title
            if title.lower() in IGNORED_TITLES:
                continue
            name = tab.get("name") if isinstance(tab.get("name"), str) else ""
            if name == title:
                continue
            before = prev.get(address)
            changed = before is not None and before != title
            if changed or (before is None and name == ""):
                renames[tab["id"]] = title
    return renames, observed


def apply_renames(doc_value: dict[str, Any], renames: dict[str, str]) -> dict[str, Any]:
    """탭 이름을 바꾼 새 문서. 원본은 건드리지 않는다."""
    spaces = []
    for space in doc_value.get("spaces") or []:
        if not isinstance(space, dict) or not isinstance(space.get("tabs"), list):
            spaces.append(space)
            continue
        tabs = [
            {**tab, "name": renames[tab["id"]]} if isinstance(tab, dict) and tab.get("id") in renames else tab
            for tab in space["tabs"]
        ]
        spaces.append({**space, "tabs": tabs})
    return {**doc_value, "spaces": spaces}


# ---- hc 호출 ----

def call_api(calls: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    """`hc connect`(stdin/stdout JSON-RPC)로 차례로 부른다. 각 응답(result 또는 error)."""
    lines = [
        json.dumps({"jsonrpc": "2.0", "id": i, "method": m, "params": p}, ensure_ascii=False)
        for i, (m, p) in enumerate(calls, start=1)
    ]
    proc = subprocess.run(
        [HC, "connect"], input="\n".join(lines) + "\n", capture_output=True, text=True,
        timeout=HC_TIMEOUT_SECONDS, check=False,
    )
    responses: dict[int, dict[str, Any]] = {}
    for line in proc.stdout.splitlines():
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(msg, dict) and isinstance(msg.get("id"), int):
            responses[msg["id"]] = msg
    return [responses.get(i, {"error": {"message": "no response"}}) for i in range(1, len(calls) + 1)]


class TitleSync:
    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.prev: dict[str, str] = {}

    def tick(self) -> None:
        listed, machines = call_api([("terminal.list", {}), ("machine.list", {})])
        terminals = (listed.get("result") or {}).get("terminals")
        if not isinstance(terminals, list):
            log.warning("terminal.list 실패: %s", listed.get("error"))
            return
        titles = claude_titles(terminals)
        names: list[str | None] = [None]
        for m in (machines.get("result") or {}).get("machines") or []:
            if isinstance(m, dict) and m.get("state") == "connected" and not m.get("temporary"):
                names.append(m.get("name"))
        for machine in names:
            self.sync_machine(machine, titles)
        # 사라진 터미널 기억은 버린다
        self.prev = {a: t for a, t in self.prev.items() if a in titles}

    def sync_machine(self, machine: str | None, titles: dict[str, str]) -> None:
        (got,) = call_api([("doc.get", {"name": APP_DOC, "on": machine})])
        doc = got.get("result")
        if not isinstance(doc, dict) or not isinstance(doc.get("value"), dict):
            return  # 앱을 한 번도 안 띄운 머신·끊긴 머신
        renames, observed = plan_renames(doc["value"], machine, titles, self.prev)
        if renames:
            if self.dry_run:
                log.info("[dry-run] %s: %s", machine or "server", renames)
                return
            value = apply_renames(doc["value"], renames)
            (put,) = call_api([("doc.set", {"name": APP_DOC, "on": machine, "value": value,
                                            "version": doc.get("version", 0)})])
            if "result" not in put:
                # conflict 등 — 본 제목을 기억하지 않아야 다음 차례에 '바뀜'으로 다시 잡힌다
                log.info("탭 이름 쓰기 재시도 예정(%s): %s", machine or "server", put.get("error"))
                return
            log.info("탭 이름 바꿈(%s): %s", machine or "server", renames)
        self.prev.update(observed)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--once", action="store_true", help="한 번만 맞추고 끝낸다")
    parser.add_argument("--dry-run", action="store_true", help="바꿀 것만 출력")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    sync = TitleSync(dry_run=args.dry_run)
    while True:
        try:
            sync.tick()
        except Exception:
            log.exception("한 차례 실패 — 다음 차례에 다시")
        if args.once:
            return 0
        time.sleep(CHECK_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
