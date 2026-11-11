"""'끝남'(done) 세션을 눌러 봐도 다른 세션을 누를 때까지는 '끝남'으로 보이게 — my-agents·my-spaces·my-tabs 공용.

앱 본체는 done 세션을 보는 순간 idle(쉬는 중)로 바꾼다(seen.json, mod 로 못 바꿈). 그래서 **표시만** 늦춘다:
mod 안의 agents()·spaces() 부름을 shownAgents()·shownSpaces() 로 바꿔, 보고 있는 세션이 '보기 직전에 done'
이었으면 그 세션(과 그 탭·공간)의 idle 을 done 으로 돌려준다. 다른 세션(또는 셸 창)을 누르면 놓는다.
다시 일하기 시작해도(working·blocked) 놓는다. 앱·엔진의 실제 상태는 건드리지 않는다.

mod 마다 따로 계산하지만 규칙이 같아 같은 답이 나온다(서로 기다리지 않게 shared 를 안 씀).
"""
from __future__ import annotations

import re
import sys

from patchlib import HERDR_IMPORT, ensure_imports

MARK = "[herdr-use done-hold]"
CALLS = re.compile(r"(?<![\w.$])(agents|spaces)\(\)")
SHOWN = {"agents": "shownAgents()", "spaces": "shownSpaces()"}
HOLD_JS = r'''
// [herdr-use done-hold] '끝남'(done) 세션을 눌러 봐도 다른 세션을 누를 때까지는 끝남으로 보인다.
// 앱은 보는 순간 쉬는 중(idle)으로 바꾸므로 표시만 늦춘다. 설치 스크립트 done_hold.py 가 넣는다.
const DONE_HOLD = { focus: null, held: null, last: new Map() };
const HOLD_RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// 보고 있는 세션이 보기 직전에 done 이었으면 그 세션을 돌려준다(아니면 null).
function holdDone(list) {
  const cur = list.find((a) => a.focused)?.address ?? null;
  if (cur !== DONE_HOLD.focus) {
    DONE_HOLD.focus = cur;
    DONE_HOLD.held = cur !== null && DONE_HOLD.last.get(cur) === "done" ? cur : null;
  }
  const held = list.find((a) => a.address === DONE_HOLD.held) ?? null;
  if (!held || (held.status !== "idle" && held.status !== "done")) DONE_HOLD.held = null;
  DONE_HOLD.last = new Map(list.map((a) => [a.address, a.status]));
  return DONE_HOLD.held ? held : null;
}
function shownAgents() {
  const raw = agents();
  const held = holdDone(raw);
  return held ? raw.map((a) => (a === held && a.status === "idle" ? { ...a, status: "done" } : a)) : raw;
}
function shownSpaces() {
  const raw = spaces();
  const held = holdDone(agents());
  if (!held) return raw;
  const up = (s) => ((HOLD_RANK[s] ?? 0) < HOLD_RANK.done ? "done" : s);
  return raw.map((s) => (s.id !== held.space ? s : {
    ...s,
    status: up(s.status),
    tabs: (s.tabs ?? []).map((tab) => (tab.id === held.tab ? { ...tab, status: up(tab.status) } : tab)),
  }));
}
'''


def apply(src: str, label: str) -> str:
    """원본 mod 코드의 agents()·spaces() 를 감싼 판으로 바꾸고 도우미를 import 줄 뒤에 넣는다."""
    if MARK in src:
        sys.exit("%s mod 에 done-hold 가 이미 들어 있음 — 원본에서 다시 고쳐야 함" % label)
    src = ensure_imports(CALLS.sub(lambda m: SHOWN[m.group(1)], src), ("agents", "spaces"))
    m = HERDR_IMPORT.search(src)
    return src[:m.end()] + "\n" + HOLD_JS + src[m.end():]
