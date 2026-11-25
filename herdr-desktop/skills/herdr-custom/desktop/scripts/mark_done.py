"""Agents 줄 우클릭 → 「끝남으로 표시」(슬랙 '읽지 않음으로 표시' 같은 것) — my-agents 에 넣는다.

앱은 세션을 열면 터미널 이름표 herdr.seen=<본 턴 번호> 를 붙이고, 이 값이 turn 과 같으면 '쉬는 중'으로 보인다.
seen 을 turn-1 로 내리면 앱을 다시 켜지 않아도 Agents·Spaces·상단 탭이 다시 '끝남'이 된다(이름표를 지우기만
하면 화면이 안 바뀐다 — 회사 PC 앱 0.1.18 실측). 엔진 이름표라 서버로 이어진 다른 화면에도 똑같이 보인다.
- 지금 보고 있는 세션은 앱이 곧바로 '봤음'으로 되돌리므로 메뉴를 흐리게 막는다. 쉬는 중(idle)일 때만 누를 수 있다.
- 팝업은 기존 정렬 메뉴(sortMenu)처럼 이 mod 자신을 props.agentMenu 로 다시 연다(새 mod 없음).
- 하위 에이전트 줄·좁힌 사이드바 줄에는 넣지 않는다.
- 앱 명령(herdr-app commands)에는 이름표를 바꾸는 것이 없어 mod 안에서 hc(["label", …]) 를 쓴다.
"""
from __future__ import annotations

import sys

from patchlib import HERDR_IMPORT, apply_patches, ensure_imports

MARK = "[herdr-use mark-done]"
NL = "\n"

MARK_JS = NL.join([
    "",
    "// " + MARK + " Agents 줄 우클릭 → 「끝남으로 표시」. 설치 스크립트 mark_done.py 가 넣는다.",
    "// 앱은 이름표 herdr.seen 이 turn 보다 작으면 '끝남'으로 다시 보여 준다 → seen=turn-1 을 붙인다.",
    "async function markDone(address) {",
    "  let turn = NaN;",
    "  try {",
    '    const r = await hc(["get", address, "--json"]);',
    '    if (r.code !== 0) return "세션을 읽지 못했습니다";',
    "    turn = Number(JSON.parse(r.stdout)?.turn);",
    "  } catch (_e) {",
    '    return "세션을 읽지 못했습니다";',
    "  }",
    '  if (!Number.isFinite(turn) || turn < 1) return "아직 끝난 턴이 없습니다";',
    '  const w = await hc(["label", address, `herdr.seen=${turn - 1}`]);',
    '  return w.code === 0 ? null : "이름표를 바꾸지 못했습니다";',
    "}",
    "",
])

# 우클릭 팝업(이 mod 를 props.agentMenu = { address, status, focused } 로 다시 연 것)
MENU_METHOD = NL.join([
    "  // " + MARK + " 우클릭 메뉴",
    "  agentMenu(t) {",
    "    const m = props().agentMenu;",
    '    const why = m.focused ? "지금 보고 있는 세션입니다 — 다른 세션을 연 뒤 표시하세요"',
    '      : m.status === "done" ? "이미 끝남으로 보입니다"',
    '      : m.status !== "idle" ? "쉬는 중인 세션만 표시할 수 있습니다" : null;',
    "    const msg = this.menuMsg ?? why;",
    "    const can = !why && !this.menuBusy;",
    "    return v_flex()",
    "      .w_full()",
    "      .p(5)",
    "      .bg(t.popover)",
    "      .text_size(12.8)",
    "      .child(h_flex()",
    '        .id("mark-done")',
    "        .h(31)",
    "        .px(8)",
    "        .gap(9)",
    "        .rounded(7)",
    "        .items_center()",
    "        .text_color(can ? t.foreground : t.dim)",
    "        .when(can, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {",
    "          this.menuBusy = true;",
    "          this.menuMsg = null;",
    "          cx.notify();",
    "          cx.spawn(async (cx) => {",
    "            const err = await markDone(m.address);",
    "            this.menuBusy = false;",
    "            if (!err) return closeOverlay(props().overlay);",
    "            this.menuMsg = err;",
    "            cx.notify();",
    "          });",
    "        }))",
    '        .child(div().flex_1().child(this.menuBusy ? "표시하는 중…" : "끝남으로 표시")))',
    "      .when(Boolean(msg), (el) => el.child(div().px(8).pt(2).pb(4).text_size(11).text_color(t.dim).child(msg)));",
    "  }",
    "",
    "  sortMenu(t) {",
])

RIGHT_CLICK = NL.join([
    '        .on_click(() => run("pane.focus", { pane: a.pane }))',
    "        .on_mouse_down(\"right\", (_e, cx) => {",
    "          cx.stop_propagation();",
    '          openOverlay({ mod: "agents", kind: "popup", width: 240, height: 90, props: { agentMenu: { address: a.address, status: a.status, focused: a.focused } } });',
    "        })",
    "        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)",
])

PATCHES = [
    ("    if (props()?.sortMenu) return;", "    if (props()?.sortMenu || props()?.agentMenu) return;"),
    ("    if (props()?.sortMenu) return this.sortMenu(t);",
     "    if (props()?.sortMenu) return this.sortMenu(t);" + NL + "    if (props()?.agentMenu) return this.agentMenu(t);"),
    ("  sortMenu(t) {", MENU_METHOD),
    # 넓은 줄의 클릭(좁힌 줄은 바로 아래 .child 가 와서 이 문장과 안 겹친다)
    (NL.join(['        .on_click(() => run("pane.focus", { pane: a.pane }))',
              "        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)"]), RIGHT_CLICK),
]


def apply(src: str, label: str) -> str:
    """원본 agents mod 코드에 우클릭 메뉴를 넣는다. 이미 들어 있으면 멈춘다(원본에서 다시 고쳐야 함)."""
    if MARK in src:
        sys.exit("%s mod 에 mark-done 이 이미 들어 있음 — 원본에서 다시 고쳐야 함" % label)
    src = ensure_imports(apply_patches(src, PATCHES, label), ("hc", "openOverlay", "closeOverlay", "props"))
    m = HERDR_IMPORT.search(src)
    return src[:m.end()] + NL + MARK_JS + src[m.end():]
