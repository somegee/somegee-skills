"""herdr 앱 좌상단 Spaces 목록에 공간별 세션 목록을 붙인다.
- 공간 줄 왼쪽 ▾/▸ 버튼으로 그 공간의 세션 목록을 펼치고 접는다(공간 선택·끌어서 순서 바꾸기와 안 겹침).
- 펼침 상태는 앱을 다시 켜도 유지(mod localStorage "spaces.open"). 기본값: 선택된 공간만 펼침.
- 세션 줄: 세션명(my-agents 와 같은 규칙) + 오른쪽 상태(작업 중 스피너 / Needs you / 끝남 / 쉬는 중).
  작업 중이면 아래 작은 글씨로 hc get --json 의 status.msg (3초 간격, 펼친 공간의 작업 중 세션만).
- 세션 줄을 누르면 그 창으로 이동(pane.focus). 사이드바가 좁은(compact) 모드에선 기존 그대로.

기본 spaces mod 는 읽기 전용(앱 시작 때 원본 복구)이라 my-spaces 로 복제해 고치고,
내 레이아웃이 my-spaces 를 쓰게 바꾼다.
  python install_spaces_tree.py            # 적용 (멱등)
  python install_spaces_tree.py --remove   # 기본 spaces 로 되돌림 (my-spaces 폴더는 남김)

기본 mod 가 업데이트돼 고칠 문장을 못 찾으면 멈춘다 → mods/spaces/main.js 를 보고 PATCHES 를 맞춘다.
`this.refreshMachines(cx);` 는 원본에 2번 나와서 앵커로 못 쓴다 → 15000 타이머 줄을 앵커로 쓴다.
"""
import io
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME, app_exe, ensure_own_layout  # noqa: E402
from install_agents_name_only import point_layout  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "spaces"
CLONE = "my-spaces"
CLONE_JS = os.path.join(APP_HOME, "mods", CLONE, "main.js")
MARK = "// ---- my-spaces ----"  # 이 표식이 있으면 이미 고친 파일 → 건너뜀

HELPERS = r'''
// ---- my-spaces: 공간 아래 세션 목록 ----
const cleanTitle = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const cur = leads.get(p.tab);
    if (!cur || (!cur.program?.agent && (p.program?.agent || (!cur.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function sessionName(tab, l, a) {
  const prog = l?.program?.name ?? a.program?.name;
  const live = cleanTitle(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) &&
    !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  if (tab && (tab.name === prog || !tab.named) && telling) return live;
  if (tab && (!tab.named || /^tb\d+$/.test(tab.name))) return prog ?? "Terminal";
  return tab?.name ?? a.tab_name ?? prog ?? a.address;
}

function statusMark(t, s) {
  if (s === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (s === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  if (s === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(4).bg(s === "done" ? (t.done ?? t.dim) : t.dim + "00");
}

function loadOpenState() {
  try {
    return JSON.parse(localStorage.getItem("spaces.open") ?? "{}") ?? {};
  } catch (_e) {
    return {};
  }
}
'''

METHODS = r'''
  // ---- my-spaces ----
  isOpen(w) {
    return this.openState[w.id] ?? !!w.active;
  }

  toggle(w, cx) {
    this.openState[w.id] = !this.isOpen(w);
    const ids = new Set(spaces().map((s) => s.id));
    for (const k of Object.keys(this.openState)) if (!ids.has(k)) delete this.openState[k];
    localStorage.setItem("spaces.open", JSON.stringify(this.openState));
    cx.notify();
  }

  chev(w, t, has) {
    if (!has) return div().w(12).flex_none();
    return div().id(`space-fold-${w.id}`).w(12).h(18).flex_none().flex().items_center().justify_center().rounded(4)
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); this.toggle(w, cx); })
      .child(svg(`mods/workspace-chrome/chevron-${this.isOpen(w) ? "down" : "right"}.svg`).size(11));
  }

  sessionsOf(w) {
    return agents().filter((a) => a.space === w.id).sort((x, y) => (x.tab_index ?? 0) - (y.tab_index ?? 0));
  }

  sessionRows(w, t) {
    if (!this.isOpen(w)) return [];
    const list = this.sessionsOf(w);
    if (!list.length) return [];
    const leads = leadPanes(panes());
    const tabs = new Map((w.tabs ?? []).map((tab) => [tab.id, tab]));
    const shown = focused()?.agent;
    return list.map((a) => {
      const msg = a.status === "working" ? this.msgs.get(a.address) : null;
      const on = a.address === shown;
      return h_flex().id(`space-agent-${a.address}`).pl(36).pr(8).h(msg ? 38 : 26).flex_none().gap(8).items_center().rounded(7)
        .text_size(12.5)
        .when(on, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover))
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_color(on ? t.foreground : t.muted).child(sessionName(tabs.get(a.tab), leads.get(a.tab), a)))
          .when(Boolean(msg), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(msg))))
        .child(statusMark(t, a.status));
    });
  }

  pollMsgs(cx) {
    if (this.polling) return;
    const working = agents().filter((a) => a.status === "working" &&
      this.isOpen({ id: a.space, active: spaces().find((s) => s.id === a.space)?.active }));
    if (!working.length && !this.msgs.size) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      const next = new Map();
      for (const a of working) {
        try {
          const r = await hc(["get", a.address, "--json"]);
          const msg = r.code === 0 ? JSON.parse(r.stdout)?.status?.msg : null;
          if (msg) next.set(a.address, String(msg));
        } catch (_e) {}
      }
      this.polling = false;
      const same = next.size === this.msgs.size && [...next].every(([k, v]) => this.msgs.get(k) === v);
      this.msgs = next;
      if (!same) cx.notify();
    });
  }

  render() {'''

PATCHES = [
    ("import { spaces, machines, panes, run,", "import { spaces, machines, panes, agents, focused, run,"),
    ("export default class Spaces extends View {", HELPERS + "\nexport default class Spaces extends View {"),
    # this.refreshMachines(cx); 는 원본에 2번 나와 앵커로 못 씀 → 15000 타이머 줄
    ("    cx.timer.every(15000, cx => this.refreshMachines(cx));\n",
     "    cx.timer.every(15000, cx => this.refreshMachines(cx));\n"
     "    this.openState = loadOpenState();\n"
     "    this.msgs = new Map();\n"
     "    cx.timer.every(3000, (cx) => this.pollMsgs(cx));\n"),
    ("const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));",
     "const draw = (r) => (collapsed ? [this.compact(r, t)] : [this.row(r, t), ...this.sessionRows(r.w, t)]);"),
    ("return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw);",
     "return loading(null) && !rows.length ? [loadingRow(null)] : rows.flatMap(draw);"),
    ("mine.length ? mine.map(draw) :", "mine.length ? mine.flatMap(draw) :"),
    ("          .gap(9)\n          .items_center()\n          .when(Boolean(tree),",
     "          .gap(9)\n          .items_center()\n          .child(this.chev(w, t, this.sessionsOf(w).length > 0))\n"
     "          .when(Boolean(tree),"),
    ("\n  render() {", METHODS),
]

HERDR_IMPORT = re.compile(r'import \{([^}]*)\} from "herdr";')


def ensure_hc_import(src):
    """pollMsgs 가 hc 를 쓴다. 기본 spaces mod 가 이미 들여오지만, 빠졌으면 넣는다."""
    m = HERDR_IMPORT.search(src)
    if not m:
        sys.exit('"herdr" import 줄을 못 찾음(기본 spaces mod 가 바뀐 듯)')
    names = [n.strip() for n in m.group(1).split(",")]
    if "hc" in names:
        return src
    body = m.group(1).rstrip().rstrip(",")  # 끝 쉼표(여러 줄 import)면 ",," 가 되지 않게
    return src[:m.start(1)] + body + ", hc " + src[m.end(1):]


def patch(src):
    if MARK in src:
        return src  # 이미 고친 파일 (시험 적용본 포함)
    for old, new in PATCHES:
        if new in src:
            continue
        if src.count(old) != 1:
            sys.exit("고칠 문장을 못 찾음(기본 spaces mod 가 바뀐 듯): " + old.strip()[:80])
        src = src.replace(old, new)
    return ensure_hc_import(src)


def install():
    target = ensure_own_layout()
    if not os.path.exists(CLONE_JS):
        subprocess.run([app_exe(), "do", "mod.clone", json.dumps({"name": BASE, "as": CLONE})], check=True)
        for _ in range(20):
            if os.path.exists(CLONE_JS):
                break
            time.sleep(0.25)
    if not os.path.exists(CLONE_JS):
        sys.exit("mod.clone 뒤에도 " + CLONE_JS + " 가 안 생김 — 앱이 켜져 있는지 확인")
    with io.open(CLONE_JS, encoding="utf-8") as f:
        src = f.read()
    new = patch(src)
    if new != src:
        with io.open(CLONE_JS, "w", encoding="utf-8") as f:
            f.write(new)
    n = point_layout(target, BASE, CLONE)
    print("적용 완료: 레이아웃", target, "/ spaces → my-spaces 연결", n, "곳", "(코드 변경 없음)" if new == src else "(코드 고침)")


def remove():
    target = ensure_own_layout()
    print("되돌림:", point_layout(target, CLONE, BASE), "곳 (레이아웃 " + target + ")")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install()
