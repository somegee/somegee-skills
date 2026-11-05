"""herdr 앱 왼쪽 Agents 목록을 고친다.
- '공간이름 · 세션명' 대신 세션명만 보이게 한다.
- working 인 줄 아래에 지금 하는 일(Claude 가 보낸 status.msg)을 작은 글씨로 보여 준다.

기본 agents mod 는 읽기 전용(앱 시작 때 원본 복구)이라 my-agents 로 복제해 고치고,
내 레이아웃이 my-agents 를 쓰게 바꾼다.
  python install_agents_name_only.py            # 적용 (멱등)
  python install_agents_name_only.py --remove   # 기본 agents 로 되돌림 (my-agents 폴더는 남김)

기본 mod 가 업데이트돼 고칠 문장을 못 찾으면 멈춘다 → mods/agents/main.js 를 보고 PATCHES 를 맞춘다.
"""
import io
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME, app_exe, children_lists, ensure_own_layout, load, save  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CLONE = "my-agents"
CLONE_JS = os.path.join(APP_HOME, "mods", CLONE, "main.js")
NL = "\n"

# '지금 하는 일' 읽기: agents() 에는 msg 가 없어서 hc get <주소> --json 의 status.msg 를 3초마다 읽는다.
POLL_METHOD = NL.join([
    "    cx.timer.every(30000, (cx) => cx.notify());",
    "    this.msgs = new Map();",
    "    this.pollMsgs(cx);",
    "    cx.timer.every(3000, (cx) => this.pollMsgs(cx));",
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
    "        } catch (_e) {}",
    "      }",
    "      this.polling = false;",
    "      const same = next.size === this.msgs.size && [...next].every(([k, v]) => this.msgs.get(k) === v);",
    "      this.msgs = next;",
    "      if (!same) cx.notify();",
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
     'closeOverlay, props, window, layout, hc } from "herdr";'),
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


def point_layout(name, frm, to):
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


def patch(src):
    for old, new in PATCHES:
        if new in src:
            continue  # 이미 고침 (new 가 old 를 품는 패치도 있어 new 로만 판정)
        if src.count(old) != 1:
            sys.exit("고칠 문장을 못 찾음(기본 mod 가 바뀐 듯): " + old[:80])
        src = src.replace(old, new)
    return src


def install():
    target = ensure_own_layout()
    if not os.path.exists(CLONE_JS):
        subprocess.run([app_exe(), "do", "mod.clone", json.dumps({"name": "agents", "as": CLONE})], check=True)
        for _ in range(20):
            if os.path.exists(CLONE_JS):
                break
            time.sleep(0.25)
    with io.open(CLONE_JS, encoding="utf-8") as f:
        src = f.read()
    new = patch(src)
    if new != src:
        with io.open(CLONE_JS, "w", encoding="utf-8") as f:
            f.write(new)
    n = point_layout(target, "agents", CLONE)
    print("적용 완료: 레이아웃", target, "/ agents → my-agents 연결", n, "곳", "(코드 변경 없음)" if new == src else "(코드 고침)")


def remove():
    target = ensure_own_layout()
    print("되돌림:", point_layout(target, CLONE, "agents"), "곳 (레이아웃 " + target + ")")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install()
