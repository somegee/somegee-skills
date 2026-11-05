"""herdr 앱 왼쪽 Agents 목록을 고친다.
- '공간이름 · 세션명' 대신 세션명만 보이게 한다.
- working 인 줄 아래에 지금 하는 일(Claude 가 보낸 status.msg)을 작은 글씨로 보여 준다.

기본 agents mod 는 읽기 전용(앱 시작 때 원본 복구)이라 my-agents 로 복제해 고치고,
내 레이아웃이 my-agents 를 쓰게 바꾼다.
  python install_agents_name_only.py            # 적용 (멱등)
  python install_agents_name_only.py --remove   # 기본 agents 로 되돌림 (my-agents 폴더는 남김)

설치할 때마다 원본 mods/agents/main.js 에서 다시 고쳐 덮어쓴다(patchlib). 기본 mod 가 업데이트돼
고칠 문장을 못 찾으면 멈춘다 → 원본을 보고 PATCHES 를 맞춘다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import children_lists, ensure_own_layout, load, save  # noqa: E402
from patchlib import apply_patches, rebuild  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "agents"
CLONE = "my-agents"
NL = "\n"

# '지금 하는 일' 읽기: agents() 에는 msg 가 없어서 hc get <주소> --json 의 status.msg 를 3초마다 읽는다.
# 읽은 결과는 shared("agent.msgs") 로도 내놓는다 → my-spaces 는 따로 hc get 을 돌리지 않고 이걸 쓴다.
POLL_METHOD = NL.join([
    "    cx.timer.every(30000, (cx) => cx.notify());",
    "    this.msgs = new Map();",
    '    setShared("agent.msgs", {}); // 앱을 다시 켰을 때 남아 있던 옛 글을 비운다',
    "    this.pollMsgs(cx);",
    "    cx.timer.every(MSG_POLL_MS, (cx) => this.pollMsgs(cx));",
    "  }",
    "",
    "  pollMsgs(cx) {",
    "    if (this.polling) return;",
    '    const working = agents().filter((a) => a.status === "working");',
    "    if (!working.length && !this.msgs.size) return;",
    "    this.polling = true;",
    "    cx.spawn(async (cx) => {",
    "      const next = new Map();",
    "      for (const a of working) {",
    "        try {",
    '          const r = await hc(["get", a.address, "--json"]);',
    "          const msg = r.code === 0 ? JSON.parse(r.stdout)?.status?.msg : null;",
    "          if (msg) next.set(a.address, String(msg));",
    "        } catch (_e) {",
    "          // 한 번 못 읽으면(세션이 막 끝남·응답 깨짐) 지난 글을 그대로 둔다 — 다음 차례(3초)에 다시 읽는다",
    "          const prev = this.msgs.get(a.address);",
    "          if (prev) next.set(a.address, prev);",
    "        }",
    "      }",
    "      this.polling = false;",
    "      const same = next.size === this.msgs.size && [...next].every(([k, v]) => this.msgs.get(k) === v);",
    "      this.msgs = next;",
    "      if (!same) {",
    '        setShared("agent.msgs", Object.fromEntries(next));',
    "        cx.notify();",
    "      }",
    "    });",
    "  }",
])

PATCHES = [
    # 정렬이 Priority 이거나 고정(pin)한 줄은 공간이름을 앞에 붙인다 → 늘 세션명만
    ("const name = full ? a.space_name || label(a) : more ??", "const name = more ??"),
    # 그 뒤에 붙던 "· 세션명" 꼬리는 끈다
    (".when(full && Boolean(more), el =>", ".when(false, el =>"),
    # 이하 '지금 하는 일'
    ('closeOverlay, props, window, layout } from "herdr";',
     'closeOverlay, props, window, layout, hc } from "herdr";' + NL
     + 'const MSG_POLL_MS = 3000; // 지금 하는 일을 다시 읽는 간격'),
    ("    cx.timer.every(30000, (cx) => cx.notify());" + NL + "  }", POLL_METHOD),
    ("      const full = byPriority || isPinned;" + NL,
     "      const full = byPriority || isPinned;" + NL
     + '      const doing = a.status === "working" ? this.msgs?.get(a.address) : null;' + NL),
    ("        .px(8)" + NL + "        .h(30)" + NL,
     "        .px(8)" + NL + "        .h(doing ? 44 : 30)" + NL),
    (".child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))",
     ".child(v_flex().flex_1().min_w(0).child(div().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(name))"
     ".when(Boolean(doing), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(doing))))"),
]


def point_layout(name: str, frm: str, to: str) -> int:
    layout = load(name)
    n = 0
    for lst in children_lists(layout):
        for child in lst:
            content = child.get("content") if isinstance(child, dict) else None
            if isinstance(content, dict) and content.get("mod") == frm:
                content["mod"] = to
                n += 1
    if n:
        save(name, layout)
    return n


def build(src: str) -> str:
    src = apply_patches(src, PATCHES, BASE)
    if "setShared" not in src.split('from "herdr";')[0]:
        src = src.replace(', hc } from "herdr";', ', hc, setShared } from "herdr";', 1)
    return src


def install() -> None:
    target = ensure_own_layout()
    changed = rebuild(BASE, CLONE, build)
    n = point_layout(target, BASE, CLONE)
    print("적용 완료: 레이아웃", target, "/ agents → my-agents 연결", n, "곳", "(코드 고침)" if changed else "(코드 변경 없음)")


def remove() -> None:
    target = ensure_own_layout()
    print("되돌림:", point_layout(target, CLONE, BASE), "곳 (레이아웃 " + target + ")")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install()
