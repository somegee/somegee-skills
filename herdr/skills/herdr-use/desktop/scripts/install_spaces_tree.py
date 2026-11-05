"""herdr 앱 좌상단 Spaces 목록에 공간별 세션 목록을 붙인다.
- 공간 줄 왼쪽 ▾/▸ 버튼으로 그 공간의 세션 목록을 펼치고 접는다(공간 선택·끌어서 순서 바꾸기와 안 겹침).
- 펼침 상태는 앱을 다시 켜도 유지(mod localStorage "spaces.open"). 기본값: 선택된 공간만 펼침.
- 세션 줄: 세션명(my-agents 와 같은 규칙) + 오른쪽 상태(작업 중 스피너 / Needs you / 끝남 / 쉬는 중).
  작업 중이면 아래 작은 글씨로 hc get --json 의 status.msg (3초 간격, 펼친 공간의 작업 중 세션만).
- 세션 줄을 누르면 그 창으로 이동(pane.focus). 사이드바가 좁은(compact) 모드에선 기존 그대로.
- 세션 줄을 끌어 다른 공간 줄(또는 그 공간의 세션 줄) 위에 놓으면 그 공간으로 옮긴다(같은 기기만, 프로그램은 안 끊김).
  놓일 공간 줄엔 점선 테두리. 옮긴 뒤엔 그 공간을 펼치고 옮긴 창으로 이동. 목록 밖에 놓으면 취소.

기본 spaces mod 는 읽기 전용(앱 시작 때 원본 복구)이라 my-spaces 로 복제해 고치고,
내 레이아웃이 my-spaces 를 쓰게 바꾼다.
  python install_spaces_tree.py            # 적용 (멱등)
  python install_spaces_tree.py --remove   # 기본 spaces 로 되돌림 (my-spaces 폴더는 남김)

기본 mod 가 업데이트돼 고칠 문장을 못 찾으면 멈춘다 → mods/spaces/main.js 를 보고 PATCHES 를 맞춘다.
`this.refreshMachines(cx);` 는 원본에 2번 나와서 앵커로 못 쓴다 → 15000 타이머 줄을 앵커로 쓴다.
고치기는 두 단계(트리 → 끌어 옮기기)이고 단계마다 표식이 있어, 트리만 깔린 파일엔 끌어 옮기기만 더한다.
앱 판마다 원본 문장이 조금 달라(0.1.11 은 공간을 번호 i 로, 0.1.13 은 id 로 다룸) 몇 패치는 대안 문장을 둔다.
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
TREE_MARK = "// ---- my-spaces ----"  # 트리 단계 표식 (있으면 그 단계 건너뜀)
DRAG_MARK = "// ---- my-spaces drag ----"  # 끌어 옮기기 단계 표식
RETRY_MARK = "// ---- my-spaces drag retry ----"  # 끌어 옮기기 재시도 단계 표식

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

TREE_PATCHES = [
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

# 앱엔 탭을 다른 공간으로 옮기는 명령이 없다(tab.move 는 같은 공간 안 순서만).
# → 대상 공간 선택 → terminal.park(창만 떼고 계속 실행, 빈 원래 탭은 앱이 지움)
# → terminal.keep(선택된 공간에 새 탭) → keep 탭은 이름이 터미널 주소(t18 등)라 원래 이름 복원.
# mod 의 run() 은 null 을 돌려줘 새 탭 id 를 못 받는다 → cx.sleep 으로 기다리며 panes() 에서 찾는다.
MOVE = r'''
  // ---- my-spaces drag ----
  // 앱엔 탭을 다른 공간으로 옮기는 명령이 없다 → 대상 공간 선택 → terminal.park(창만 떼고 계속 실행)
  // → terminal.keep(선택된 공간에 새 탭) → 원래 탭 이름 복원. 다른 기기 공간으로는 못 옮긴다.
  canDrop(w) {
    if (!this.dragAgent) return false;
    const a = agents().find((x) => x.address === this.dragAgent);
    if (!a || a.space === w.id) return false;
    const src = spaces().find((s) => s.id === a.space);
    return (src?.machine ?? null) === (w.machine ?? null);
  }

  dragOver(w, cx) {
    const over = this.canDrop(w) ? w.id : null;
    if (this.dragAgent && this.dropOver !== over) {
      this.dropOver = over;
      cx.notify();
    }
  }

  drop(w, cx) {
    const addr = this.dragAgent;
    const ok = addr && this.dropOver === w.id && this.canDrop(w);
    this.dragAgent = null;
    this.dropOver = null;
    if (ok) this.moveAgent(addr, w, cx);
    cx.notify();
    return ok;
  }

  moveAgent(addr, target, cx) {
    const a = agents().find((x) => x.address === addr);
    if (!a) return;
    const src = spaces().find((s) => s.id === a.space);
    const tab = (src?.tabs ?? []).find((x) => x.id === a.tab);
    const name = tab?.named ? tab.name : "";
    this.openState[target.id] = true;
    localStorage.setItem("spaces.open", JSON.stringify(this.openState));
    cx.spawn(async (cx) => {
      run("space.select", { id: target.id });
      await cx.sleep(150);
      run("terminal.park", { terminal: addr });
      await cx.sleep(300);
      run("terminal.keep", { terminal: addr, place: "tab" });
      for (let i = 0; i < 20; i++) {
        await cx.sleep(150);
        const p = panes().find((x) => x.terminal === addr);
        if (!p) continue;
        if (name) run("tab.rename", { id: p.tab, name });
        run("pane.focus", { pane: p.pane });
        break;
      }
      cx.notify();
    });
  }

  sessionRows(w, t) {'''

DROP_BORDER = "      .when(this.dropOver === w.id, (el) => el.border(1.5).border_dashed().border_color(t.accent).bg(t.hover))\n"
OPACITY_013 = "      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))\n"
OPACITY_011 = "      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))\n"
MOVE_013 = "      .on_mouse_move((_e, cx) => {\n        const source = spaces().find(s => s.id === this.pressed);"
MOVE_011 = "      .on_mouse_move((_e, cx) => {\n        const source = spaces()[this.pressed];"


def after_first_line(old, add):
    """old 의 첫 줄 뒤에 add 를 끼운다 (old 는 '\n' 으로 줄이 나뉨)."""
    head, rest = old.split("\n", 1)
    return head + "\n" + add + rest


# 항목이 리스트면 대안들 — 그중 정확히 1번 나오는 하나에만 적용한다
DRAG_PATCHES = [
    ("    this.msgs = new Map();\n",
     "    this.msgs = new Map();\n"
     "    this.dragAgent = null; // 끄는 중인 세션 주소\n"
     "    this.dropOver = null; // 놓일 공간 id\n"),
    ("\n  sessionRows(w, t) {", MOVE),
    # 공간 줄: 놓일 자리 점선 + 위로 지나갈 때 / 놓을 때
    [(OPACITY_013, OPACITY_013 + DROP_BORDER), (OPACITY_011, OPACITY_011 + DROP_BORDER)],
    [(MOVE_013, after_first_line(MOVE_013, "        this.dragOver(w, cx);\n")),
     (MOVE_011, after_first_line(MOVE_011, "        this.dragOver(w, cx);\n"))],
    ("      .on_mouse_up(\"left\", (_e, cx) => {\n        const from = this.pressed;",
     "      .on_mouse_up(\"left\", (_e, cx) => {\n"
     "        if (this.drop(w, cx)) { this.pressed = null; this.over = null; return; }\n"
     "        const from = this.pressed;"),
    # 세션 줄: 끌기 시작 / 다른 공간 세션 위도 그 공간으로 / 끄는 중이면 흐리게
    ("        .when(on, (el) => el.bg(t.raised))\n        .hover((s) => s.bg(t.hover))\n"
     "        .on_click(() => run(\"pane.focus\", { pane: a.pane }))",
     "        .when(on, (el) => el.bg(t.raised))\n        .hover((s) => s.bg(t.hover))\n"
     "        .when(this.dragAgent === a.address && this.dropOver, (el) => el.opacity(0.5))\n"
     "        .on_mouse_down(\"left\", () => { this.dragAgent = a.address; this.dropOver = null; })\n"
     "        .on_mouse_move((_e, cx) => this.dragOver(w, cx))\n"
     "        .on_mouse_up(\"left\", (_e, cx) => { if (this.dropOver) this.drop(w, cx); })\n"
     "        .on_click(() => run(\"pane.focus\", { pane: a.pane }))"),
    # 목록 밖에서 놓으면 취소
    (".on_mouse_up(\"left\", (_e, cx) => { this.pressed = null; cx.notify(); })",
     ".on_mouse_up(\"left\", (_e, cx) => { this.pressed = null; this.dragAgent = null; this.dropOver = null; cx.notify(); })"),
]

# park 가 끝나기 전에 keep 이 들어가면 keep 이 안 먹어 창 없는 세션이 된다(계속 돌지만 화면에서 사라짐).
# → 원래 창이 없어질 때까지 기다린 뒤 keep, 새 창이 안 생기면 대상 공간을 다시 고르고 최대 4번 다시 붙인다.
RETRY_OLD = """      await cx.sleep(300);
      run("terminal.keep", { terminal: addr, place: "tab" });
      for (let i = 0; i < 20; i++) {
        await cx.sleep(150);
        const p = panes().find((x) => x.terminal === addr);
        if (!p) continue;
        if (name) run("tab.rename", { id: p.tab, name });
        run("pane.focus", { pane: p.pane });
        break;
      }
"""
RETRY_NEW = """      // ---- my-spaces drag retry ----
      // park 가 끝나기 전에 keep 이 들어가면 keep 이 안 먹어 창 없는 세션이 된다(계속 돌지만 화면에서 사라짐).
      // → 원래 창이 없어질 때까지 기다린 뒤 keep, 새 창이 안 생기면 대상 공간을 다시 고르고 최대 4번 다시 붙인다.
      const paneOf = () => panes().find((x) => x.terminal === addr);
      for (let i = 0; i < 20 && paneOf(); i++) await cx.sleep(150);
      let p = null;
      for (let tries = 0; tries < 4 && !p; tries++) {
        if (tries) {
          run("space.select", { id: target.id });
          await cx.sleep(150);
        }
        run("terminal.keep", { terminal: addr, place: "tab" });
        for (let i = 0; i < 10 && !p; i++) {
          await cx.sleep(150);
          p = paneOf();
        }
      }
      if (p) {
        if (name) run("tab.rename", { id: p.tab, name });
        run("pane.focus", { pane: p.pane });
      }
"""
RETRY_PATCHES = [(RETRY_OLD, RETRY_NEW)]

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


def apply(src, patches):
    for entry in patches:
        alts = entry if isinstance(entry, list) else [entry]
        if any(new in src for _, new in alts):
            continue
        hits = [(old, new) for old, new in alts if src.count(old) == 1]
        if len(hits) != 1:
            sys.exit("고칠 문장을 못 찾음(기본 spaces mod 가 바뀐 듯): " + alts[0][0].strip()[:80])
        old, new = hits[0]
        src = src.replace(old, new)
    return src


def patch(src):
    """단계마다 표식을 보고, 없는 단계만 더한다 (시험 적용본 포함 몇 번 돌려도 같은 결과)."""
    if TREE_MARK not in src:
        src = ensure_hc_import(apply(src, TREE_PATCHES))
    if DRAG_MARK not in src:
        src = apply(src, DRAG_PATCHES)
    if RETRY_MARK not in src:
        src = apply(src, RETRY_PATCHES)
    return src


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
