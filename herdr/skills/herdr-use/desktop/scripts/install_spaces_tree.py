"""herdr 앱 좌상단 Spaces 목록에 공간별 세션 목록을 붙인다.
- 공간 줄 왼쪽 ▾/▸ 버튼으로 그 공간의 세션 목록을 펼치고 접는다(공간 선택·끌어서 순서 바꾸기와 안 겹침).
- 펼침 상태는 앱을 다시 켜도 유지(mod localStorage "spaces.open"). 기본값: 선택된 공간만 펼침.
- 세션 줄: 세션명(my-agents 와 같은 규칙) + 오른쪽 상태(작업 중 스피너 / Needs you / 끝남 / 쉬는 중).
  작업 중이면 아래 작은 글씨로 지금 하는 일(status.msg).
- 세션 줄을 누르면 그 창으로 이동(pane.focus). 사이드바가 좁은(compact) 모드에선 기존 그대로.
- 세션 줄을 끌어 다른 공간 줄(또는 그 공간의 세션 줄) 위에 놓으면 그 공간으로 옮긴다(같은 기기만, 프로그램은 안 끊김).
  놓일 공간 줄엔 점선 테두리. 옮긴 뒤엔 그 공간을 펼치고 옮긴 창으로 이동.
  목록 안 빈 곳에 놓거나, 목록 밖으로 나가거나, 밖을 누르면 취소. 못 옮기면 알림을 띄우고 원래 공간에 되돌린다.
- 빈 공간 남기기: 마지막 세션이 닫혀(또는 끌려 나가) 사라진 공간을 기억해 흐린 "빈 공간 줄"로 계속 그린다.
  앱 규칙상 공간엔 탭이 1개 이상이어야 해서 진짜 빈 공간은 못 만든다 → 이 mod 가 이름·폴더·색을 기억한다
  (mod localStorage "spaces.kept", 이 화면에만). 빈 공간 줄을 누르면 같은 이름·폴더·색으로 기본 셸 탭과 함께 되살리고,
  세션을 끌어 놓으면 되살린 뒤 그 세션만 넣는다(임시 셸 탭은 닫음). 오른쪽 × 는 완전히 없애기.
  탭이 2개 이상이던 공간을 통째로 닫은 것, 이미 비어 있던(탭 0개) 공간을 지운 것,
  안의 세션이 살아 있는데 공간만 지워진 것(웹 휴지통 — hc ls 로 확인, 0.5.3), 이름을 안 붙인 공간(named false — 0.5.4)은 남기지 않는다.

기본 spaces mod 는 읽기 전용(앱 시작 때 원본 복구)이라 my-spaces 로 복제해 고치고,
내 레이아웃이 my-spaces 를 쓰게 바꾼다.
  python install_spaces_tree.py            # 적용 (멱등)
  python install_spaces_tree.py --remove   # 기본 spaces 로 되돌림 (my-spaces 폴더는 남김)

설치할 때마다 원본 mods/spaces/main.js 에서 처음부터 다시 고쳐 덮어쓴다(patchlib) — 단계 표식·덧대기 없음.
기본 mod 가 업데이트돼 고칠 문장을 못 찾으면 멈춘다 → 원본을 보고 패치를 맞춘다.
`this.refreshMachines(cx);` 는 원본에 2번 나와서 앵커로 못 쓴다 → 15000 타이머 줄을 앵커로 쓴다.
앱 판마다 원본 문장이 조금 달라(0.1.11 은 공간을 번호 i 로, 0.1.13 은 id 로 다룸) 몇 패치는 대안 문장을 둔다.
지금 하는 일은 my-agents 가 레이아웃에 있으면 그쪽이 읽어 shared("agent.msgs") 로 내놓은 것을 쓰고,
없을 때만 직접 hc get 으로 읽는다(같은 일을 두 번 돌리지 않게).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import ensure_own_layout  # noqa: E402
from install_agents_name_only import point_layout  # noqa: E402
from patchlib import apply_patches, ensure_imports, rebuild  # noqa: E402
import done_hold  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "spaces"
CLONE = "my-spaces"

HELPERS = r'''
// ---- my-spaces: 공간 아래 세션 목록 ----
const MSG_POLL_MS = 3000; // 지금 하는 일을 다시 읽는 간격
const MSGS_KEY = "agent.msgs"; // my-agents 가 내놓는 {주소: 지금 하는 일}
// 세션 옮기기: 기다리는 간격·한도
const MOVE_STEP_MS = 150; // 상태를 다시 보는 간격
const MOVE_SELECT_MS = 150; // space.select 가 반영될 때까지
const MOVE_PARK_WAIT_MS = 8000; // terminal.park 로 원래 창이 떨어질 때까지 (넘기면 옮기기 취소)
const MOVE_KEEP_WAIT_MS = 3000; // terminal.keep 한 번에 새 창이 생길 때까지
const MOVE_KEEP_TRIES = 3; // keep 을 몇 번까지 보내 보나 (늦게라도 붙으면 더 안 보냄)
// 빈 공간 남기기
const KEPT_KEY = "spaces.kept"; // localStorage: 세션이 0개가 돼 사라진 공간들
const KEPT_TICK_MS = 500; // 공간 목록을 다시 보는 간격
const KEPT_CONFIRM_MS = 1500; // 사라진 뒤 이만큼 지나도 그 기기 화면이 멀쩡하면 "닫힌 것"으로 본다(연결 끊김과 구별)
const KEPT_LOOSE_WAIT_MS = 10000; // 안에 있던 세션이 '살아 있는데 어느 공간에도 없는' 채 이만큼 가면 일부러 지운 것(웹 휴지통)
const KEPT_REVIVE_WAIT_MS = 5000; // space.new 뒤 새 공간이 보일 때까지
const KEPT_TAB_WAIT_MS = 3000; // 되살린 공간의 탭 수가 반영될 때까지

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
    return {}; // 저장값이 깨졌으면 기본값(선택된 공간만 펼침)으로 시작
  }
}

function loadKept() {
  try {
    const list = JSON.parse(localStorage.getItem(KEPT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((g) => g && typeof g.name === "string" && g.named !== false) : [];
  } catch (_e) {
    return []; // 저장값이 깨졌으면 빈 목록으로 시작
  }
}

const keptKey = (machine, name) => JSON.stringify([machine ?? null, name]);

// 지금 레이아웃에 my-agents 가 있으면 그쪽이 지금 하는 일을 읽어 shared 로 내놓는다
function agentsModShown() {
  return JSON.stringify(layout() ?? null).includes('"my-agents"');
}
'''

METHODS = r'''
  // ---- my-spaces ----
  // 그릴 때마다 agents()·panes() 를 한 번만 읽는다(읽을 때마다 전부 복사돼 비싸다). render() 첫 줄에서 비운다.
  snap() {
    if (!this._snap) {
      const bySpace = new Map();
      for (const a of agents()) {
        const list = bySpace.get(a.space);
        if (list) list.push(a);
        else bySpace.set(a.space, [a]);
      }
      for (const list of bySpace.values()) list.sort((x, y) => (x.tab_index ?? 0) - (y.tab_index ?? 0));
      this._snap = { bySpace, leads: null };
    }
    return this._snap;
  }

  leads() {
    const s = this.snap();
    if (!s.leads) s.leads = leadPanes(panes());
    return s.leads;
  }

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
      .on_mouse_up("left", (_e, cx) => {
        cx.stop_propagation();
        // 세션을 끌다가 ▾/▸ 위에서 놓음 = 그 공간 줄에 놓은 것(또는 취소). 끌기 상태를 남기지 않는다.
        if (this.dragAgent) {
          this.drop(w, cx);
          return;
        }
        this.toggle(w, cx);
      })
      .child(svg(`mods/workspace-chrome/chevron-${this.isOpen(w) ? "down" : "right"}.svg`).size(11));
  }

  sessionsOf(w) {
    return this.snap().bySpace.get(w.id) ?? [];
  }

  agentMsgs() {
    if (!this.sharedMsgs) return this.msgs;
    return new Map(Object.entries(shared(MSGS_KEY) ?? {}));
  }

  sessionRows(w, t) {
    if (!this.isOpen(w)) return [];
    const list = this.sessionsOf(w);
    if (!list.length) return [];
    const leads = this.leads();
    const msgs = this.agentMsgs();
    const tabs = new Map((w.tabs ?? []).map((tab) => [tab.id, tab]));
    const shown = focused()?.agent;
    return list.map((a) => {
      const msg = a.status === "working" ? msgs.get(a.address) : null;
      const on = a.address === shown;
      return h_flex().id(`space-agent-${a.address}`).pl(36).pr(8).h(msg ? 38 : 26).flex_none().gap(8).items_center().rounded(7)
        .text_size(12.5)
        .when(on, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover))
        .when(this.dragAgent === a.address && this.dropOver, (el) => el.opacity(0.5))
        .on_mouse_down("left", () => { this.dragAgent = a.address; this.dropOver = null; })
        .on_mouse_move((_e, cx) => this.dragOver(w, cx))
        .on_mouse_up("left", (_e, cx) => { if (this.dropOver) this.drop(w, cx); })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_color(on ? t.foreground : t.muted).child(sessionName(tabs.get(a.tab), leads.get(a.tab), a)))
          .when(Boolean(msg), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(msg))))
        .child(statusMark(t, a.status));
    });
  }

  pollMsgs(cx) {
    const shown = agentsModShown();
    if (shown !== this.sharedMsgs) {
      this.sharedMsgs = shown;
      cx.notify();
    }
    if (shown || this.polling) return; // my-agents 가 대신 읽는다
    const all = spaces();
    const working = agents().filter((a) => a.status === "working" &&
      this.isOpen({ id: a.space, active: all.find((s) => s.id === a.space)?.active }));
    if (!working.length && !this.msgs.size) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      const next = new Map();
      for (const a of working) {
        try {
          const r = await hc(["get", a.address, "--json"]);
          const msg = r.code === 0 ? JSON.parse(r.stdout)?.status?.msg : null;
          if (msg) next.set(a.address, String(msg));
        } catch (_e) {
          // 한 번 못 읽으면(세션이 막 끝남·응답 깨짐) 지난 글을 그대로 둔다 — 다음 차례에 다시 읽는다
          const prev = this.msgs.get(a.address);
          if (prev) next.set(a.address, prev);
        }
      }
      this.polling = false;
      const same = next.size === this.msgs.size && [...next].every(([k, v]) => this.msgs.get(k) === v);
      this.msgs = next;
      if (!same) cx.notify();
    });
  }

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
    if (!this.dragAgent) return;
    const over = this.canDrop(w) ? w.id : null;
    if (this.dropOver !== over) {
      this.dropOver = over;
      cx.notify();
    }
  }

  // 끌기 상태를 지운다. 지운 게 있으면 true (다시 그려야 함)
  cancelDrag() {
    const had = this.dragAgent !== null || this.dropOver !== null;
    this.dragAgent = null;
    this.dropOver = null;
    return had;
  }

  drop(w, cx) {
    const addr = this.dragAgent;
    const ok = Boolean(addr) && this.dropOver === w.id && this.canDrop(w);
    this.cancelDrag();
    if (ok) this.moveAgent(addr, w, cx);
    cx.notify();
    return ok;
  }

  moveAgent(addr, target, cx) {
    cx.spawn(async (cx) => { await this.moveAgentRun(addr, target, cx); });
  }

  async waitFor(cx, check, ms) {
    for (let left = ms; left > 0; left -= MOVE_STEP_MS) {
      const v = check();
      if (v) return v;
      await cx.sleep(MOVE_STEP_MS);
    }
    return check();
  }

  // 옮긴 뒤의 창(pane)을 돌려준다. 못 옮겼으면 null.
  async moveAgentRun(addr, target, cx) {
    const a = agents().find((x) => x.address === addr);
    if (!a) return null;
    const srcId = a.space;
    const src = spaces().find((s) => s.id === srcId);
    const tab = (src?.tabs ?? []).find((x) => x.id === a.tab);
    // 이름 없던 탭은 "" 로 되돌린다(빈 이름 = 번호로 부르는 원래 상태). 안 하면 keep 이 붙인 터미널 주소(t18 등)가 남는다.
    const name = tab?.named ? tab.name : "";
    this.openState[target.id] = true;
    localStorage.setItem("spaces.open", JSON.stringify(this.openState));
    const paneOf = () => panes().find((x) => x.terminal === addr);
    const keepIn = async (spaceId) => {
      run("space.select", { id: spaceId });
      await cx.sleep(MOVE_SELECT_MS);
      run("terminal.keep", { terminal: addr, place: "tab" });
      return this.waitFor(cx, paneOf, MOVE_KEEP_WAIT_MS);
    };

    run("space.select", { id: target.id });
    await cx.sleep(MOVE_SELECT_MS);
    run("terminal.park", { terminal: addr });
    // park 가 끝나기 전에 keep 이 들어가면 keep 이 안 먹어 창 없는 세션이 된다 → 원래 창이 떨어질 때까지 기다린다.
    // 끝내 안 떨어지면 원래 창에 그대로 있는 것이라 잃은 게 없다 → 여기서 그만둔다.
    if (!(await this.waitFor(cx, () => !paneOf(), MOVE_PARK_WAIT_MS))) {
      notify({ title: "세션 옮기기 취소", body: "원래 창이 떨어지지 않아 그대로 두었습니다. 잠시 뒤 다시 끌어 보세요.", level: "warning" });
      cx.notify();
      return null;
    }
    // keep 이 늦게라도 붙으면 다시 보내지 않는다(같은 세션 탭이 둘 생기지 않게).
    let p = null;
    for (let tries = 0; tries < MOVE_KEEP_TRIES && !p; tries++) p = paneOf() ?? (await keepIn(target.id));
    if (!p) {
      // 대상 공간에 못 붙였으면 원래 공간에 되돌려 붙인다 — 창 없이 사라진 세션을 남기지 않는다.
      const back = paneOf() ?? (await keepIn(srcId));
      notify(back
        ? { title: "세션을 못 옮겼습니다", body: "원래 공간에 되돌려 두었습니다.", level: "warning" }
        : { title: "세션 창을 못 붙였습니다", body: `세션(${addr})은 계속 돌고 있습니다. hc ls 로 찾아 terminal.keep 으로 다시 붙이세요.`, level: "error" });
      if (back) run("tab.rename", { id: back.tab, name });
      cx.notify();
      return null;
    }
    run("tab.rename", { id: p.tab, name });
    run("pane.focus", { pane: p.pane });
    cx.notify();
    return p;
  }

  // ---- my-spaces kept: 세션이 0개가 된 공간을 빈 줄로 남긴다 ----
  // 앱은 마지막 탭이 닫히면 공간도 닫는다 → 사라진 공간을 여기서 기억해 그리고, 누르면 같은 이름·폴더·색으로 되살린다.
  saveKept() {
    localStorage.setItem(KEPT_KEY, JSON.stringify(this.kept));
  }

  forgetKept(key) {
    const next = this.kept.filter((g) => g.key !== key);
    if (next.length === this.kept.length) return false;
    this.kept = next;
    this.saveKept();
    return true;
  }

  machineReady(machine) {
    return machines().some((k) => (k.name ?? null) === machine && k.layout === "ready");
  }

  // 지금 살아 있는 터미널 주소들(hc ls). 못 읽으면 null — 그땐 예전처럼 빈 줄로 남긴다.
  async liveTerminals() {
    try {
      const r = await hc(["ls", "--json"]);
      if (r.code !== 0) return null;
      return new Set((JSON.parse(r.stdout).terminals ?? []).map((x) => x.address));
    } catch (_e) {
      return null;
    }
  }

  // 사라진 공간을 빈 줄로 남길지 정한다. 안에 있던 세션이 살아 있는데 어느 공간에도 없으면 남기지 않는다:
  // 웹 휴지통은 세션을 끄지 않고 공간만 지운다(일부러 지운 것). 세션을 끌어 옮기는 도중에도 잠깐 그 상태라
  // KEPT_LOOSE_WAIT_MS 까지는 다시 본다. (서버 상주 herdr-title-sync 와 같은 규칙)
  async settleGone(id, info, cx) {
    const alive = await this.liveTerminals();
    info.checking = false;
    if (this.goneSpaces[id] !== info) return;
    const placed = new Set(panes().map((p) => p.terminal).filter(Boolean));
    const loose = alive ? info.terminals.filter((x) => alive.has(x) && !placed.has(x)) : [];
    if (loose.length) {
      if (Date.now() - info.at > KEPT_LOOSE_WAIT_MS) delete this.goneSpaces[id];
      else info.next = Date.now() + KEPT_CONFIRM_MS;
      return;
    }
    delete this.goneSpaces[id];
    if (spaces().some((s) => s.id === id) || !this.machineReady(info.machine)) return;
    const key = keptKey(info.machine, info.name);
    this.kept = [...this.kept.filter((g) => g.key !== key), { key, machine: info.machine, name: info.name, named: info.named, folder: info.folder, color: info.color }];
    this.saveKept();
    cx.notify();
  }

  trackKept(cx) {
    const sp = spaces();
    const now = Date.now();
    const live = new Set(sp.map((s) => s.id));
    let changed = false;
    // 방금 사라진 공간: 이름을 붙인 공간이고 탭이 딱 1개였던 것만 후보(이름 없는 공간은 잠깐 연 셸 — 서버 상주와 같은 규칙). 탭 여러 개인 공간을 통째로 닫은 것,
    // 이미 비어 있던(탭 0개) 공간을 지운 것(웹 휴지통·앱 Close)은 일부러 없앤 것이라 남기지 않는다.
    for (const [id, info] of Object.entries(this.seenSpaces)) {
      if (live.has(id)) continue;
      delete this.seenSpaces[id];
      if (info.tabs === 1 && info.named && this.machineReady(info.machine)) this.goneSpaces[id] = { ...info, at: now };
    }
    // 잠깐 기다려도 그 기기 화면이 멀쩡하면 닫힌 것 → 빈 줄로 남긴다(연결이 끊겨 안 보이는 것과 구별)
    for (const [id, info] of Object.entries(this.goneSpaces)) {
      if (info.checking || now - info.at < KEPT_CONFIRM_MS || now < (info.next ?? 0)) continue;
      if (live.has(id) || !this.machineReady(info.machine)) {
        delete this.goneSpaces[id];
        continue;
      }
      info.checking = true;
      cx.spawn(async (cx) => { await this.settleGone(id, info, cx); });
    }
    // 같은 기기에 같은 이름 공간이 살아 있으면 빈 줄은 필요 없다(되살리는 중인 것은 reviveKept 가 지운다)
    const names = new Set(sp.map((s) => keptKey(s.machine, s.name)));
    const next = this.kept.filter((g) => this.reviving.has(g.key) || !names.has(g.key));
    if (next.length !== this.kept.length) {
      this.kept = next;
      changed = true;
    }
    const ps = panes();
    const colors = shared("space.colors") ?? {};
    for (const s of sp) {
      const tabIds = new Set((s.tabs ?? []).map((x) => x.id));
      const terminals = ps.filter((p) => p.terminal && tabIds.has(p.tab)).map((p) => p.terminal);
      this.seenSpaces[s.id] = { machine: s.machine ?? null, name: s.name, named: !!s.named, folder: place(s, ps) || "", tabs: tabIds.size, terminals, color: colors[s.id] ?? null };
    }
    if (changed) {
      this.saveKept();
      cx.notify();
    }
  }

  // 빈 공간을 되살린다(기본 셸 탭 1개와 함께). 새 공간을 돌려주고, 못 만들면 null.
  async reviveKept(g, cx) {
    if (this.reviving.has(g.key)) return null;
    this.reviving.add(g.key);
    cx.notify();
    const before = new Set(spaces().map((s) => s.id));
    const born = () => spaces().find((s) => !before.has(s.id) && (s.machine ?? null) === g.machine);
    const make = (folder) => {
      const args = { machine: g.machine ?? "" };
      if (g.named) args.name = g.name;
      if (folder) args.folder = folder;
      run("space.new", args);
      return this.waitFor(cx, born, KEPT_REVIVE_WAIT_MS);
    };
    // 기억한 폴더가 없어졌으면 앱이 공간을 안 만든다 → 폴더 없이(그 기기 홈에서) 한 번 더
    const s = (await make(g.folder)) ?? (g.folder ? await make("") : null);
    this.reviving.delete(g.key);
    if (!s) {
      notify({ title: "빈 공간을 못 열었습니다", body: `"${g.name}" 공간을 만들지 못했습니다. 기기 연결을 확인하고 다시 눌러 보세요.`, level: "warning" });
      cx.notify();
      return null;
    }
    if (g.color) setShared("space.colors", { ...(shared("space.colors") ?? {}), [s.id]: g.color });
    this.forgetKept(g.key);
    cx.notify();
    return s;
  }

  // 빈 공간 줄에 세션을 끌어 놓음: 되살린 뒤 그 세션만 남긴다(되살릴 때 같이 생긴 셸 탭은 닫는다).
  moveToKept(addr, g, cx) {
    cx.spawn(async (cx) => {
      const s = await this.reviveKept(g, cx);
      if (!s) return;
      const tabsOf = () => spaces().find((x) => x.id === s.id)?.tabs ?? [];
      const first = (await this.waitFor(cx, () => tabsOf()[0], KEPT_TAB_WAIT_MS))?.id;
      const p = await this.moveAgentRun(addr, s, cx);
      if (!p || !first) return; // 못 옮겼으면 되살린 공간은 셸 탭과 함께 그대로 둔다
      // 탭이 2개로 보일 때만 닫는다 — 1개일 때 닫으면 공간이 또 닫힌다
      const both = await this.waitFor(cx, () => tabsOf().length >= 2 && tabsOf().some((x) => x.id === first), KEPT_TAB_WAIT_MS);
      if (!both) return;
      run("tab.close", { id: first, confirmed: true });
      await cx.sleep(MOVE_SELECT_MS);
      run("pane.focus", { pane: p.pane });
      cx.notify();
    });
  }

  keptRows(m, t, collapsed) {
    if (collapsed) return [];
    const machine = m ?? null;
    if (machine && this.machines.find((k) => k.name === machine)?.state !== "connected") return [];
    return this.kept.filter((g) => g.machine === machine && !this.reviving.has(g.key)).map((g) => this.keptRow(g, t));
  }

  keptRow(g, t) {
    const pid = `kept:${g.key}`; // 놓일 자리 표시에 쓰는 가짜 공간 id
    const pw = { id: pid, machine: g.machine };
    const slug = `${g.machine ?? "local"}-${g.name}`;
    const color = g.color ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return h_flex().id(`space-kept-${slug}`).px(8).h(30).flex_none().gap(9).items_center().rounded(8)
      .hover((s) => s.bg(t.hover))
      .when(this.dropOver === pid, (el) => el.border(1.5).border_dashed().border_color(t.accent).bg(t.hover))
      .tooltip("세션 없음 · 누르면 새 탭으로 다시 엽니다 · 세션을 끌어다 놓을 수 있습니다")
      .on_mouse_move((_e, cx) => this.dragOver(pw, cx))
      .on_mouse_up("left", (_e, cx) => {
        if (!this.dragAgent) return;
        const addr = this.dragAgent;
        const ok = this.dropOver === pid && this.canDrop(pw);
        this.cancelDrag();
        if (ok) this.moveToKept(addr, g, cx);
        cx.notify();
      })
      .on_click((_e, cx) => { cx.spawn(async (cx) => { await this.reviveKept(g, cx); }); })
      .child(div().w(12).flex_none())
      .child(h_flex().size(18).flex_none().rounded(5).bg(fill).opacity(0.4).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...g.name][0]?.toUpperCase() ?? "?"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(g.name))
      .child(div().id(`space-kept-x-${slug}`).size(18).flex_none().flex().items_center().justify_center().rounded(4)
        .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("이 빈 공간을 목록에서 없애기")
        .on_click((_e, cx) => { cx.stop_propagation(); if (this.forgetKept(g.key)) cx.notify(); })
        .child("×"));
  }

  render() {
    this._snap = null; // 새로 그릴 때마다 목록을 새로 읽는다'''

TREE_PATCHES = [
    ("export default class Spaces extends View {", HELPERS + "\nexport default class Spaces extends View {"),
    # this.refreshMachines(cx); 는 원본에 2번 나와 앵커로 못 씀 → 15000 타이머 줄
    ("    cx.timer.every(15000, cx => this.refreshMachines(cx));\n",
     "    cx.timer.every(15000, cx => this.refreshMachines(cx));\n"
     "    this.openState = loadOpenState();\n"
     "    this.msgs = new Map();\n"
     "    this.sharedMsgs = agentsModShown();\n"
     "    this.dragAgent = null; // 끄는 중인 세션 주소\n"
     "    this.dropOver = null; // 놓일 공간 id\n"
     "    cx.timer.every(MSG_POLL_MS, (cx) => this.pollMsgs(cx));\n"
     "    this.kept = loadKept(); // 세션이 0개가 돼 사라진 공간들(빈 줄로 그린다)\n"
     "    this.seenSpaces = {}; // 공간 id → 마지막으로 본 모습\n"
     "    this.goneSpaces = {}; // 방금 사라져 확인을 기다리는 공간\n"
     "    this.reviving = new Set(); // 되살리는 중인 빈 공간 key\n"
     "    cx.timer.every(KEPT_TICK_MS, (cx) => this.trackKept(cx));\n"),
    ("const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));",
     "const draw = (r) => (collapsed ? [this.compact(r, t)] : [this.row(r, t), ...this.sessionRows(r.w, t)]);"),
    ("return loading(null) && !rows.length ? [loadingRow(null)] : rows.map(draw);",
     "return loading(null) && !rows.length ? [loadingRow(null)] : [...rows.flatMap(draw), ...this.keptRows(null, t, collapsed)];"),
    ("mine.length ? mine.map(draw) :",
     "(mine.length || this.keptRows(m, t, collapsed).length) ? [...mine.flatMap(draw), ...this.keptRows(m, t, collapsed)] :"),
    ("          .gap(9)\n          .items_center()\n          .when(Boolean(tree),",
     "          .gap(9)\n          .items_center()\n          .child(this.chev(w, t, this.sessionsOf(w).length > 0))\n"
     "          .when(Boolean(tree),"),
    ("\n  render() {", METHODS),
]

DROP_BORDER = "      .when(this.dropOver === w.id, (el) => el.border(1.5).border_dashed().border_color(t.accent).bg(t.hover))\n"
OPACITY_013 = "      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))\n"
OPACITY_011 = "      .when(this.pressed === i && this.over !== i, (el) => el.opacity(0.5))\n"
MOVE_013 = "      .on_mouse_move((_e, cx) => {\n        const source = spaces().find(s => s.id === this.pressed);"
MOVE_011 = "      .on_mouse_move((_e, cx) => {\n        const source = spaces()[this.pressed];"
# 공간 줄을 새로 누름 = 앞선 세션 끌기는 끝난 것 (남은 끌기 상태를 여기서 버린다)
PRESS_ROW = "      .on_mouse_down(\"left\", () => {\n        this.pressed = "
LIST_UP = ".on_mouse_up(\"left\", (_e, cx) => { this.pressed = null; cx.notify(); })"


def after_first_line(old: str, add: str) -> str:
    """old 의 첫 줄 뒤에 add 를 끼운다 (old 는 '\n' 으로 줄이 나뉨)."""
    head, rest = old.split("\n", 1)
    return head + "\n" + add + rest


DRAG_PATCHES = [
    # 공간 줄: 놓일 자리 점선 + 누를 때 남은 끌기 버림 + 위로 지나갈 때 / 놓을 때
    [(OPACITY_013, OPACITY_013 + DROP_BORDER), (OPACITY_011, OPACITY_011 + DROP_BORDER)],
    (PRESS_ROW, "      .on_mouse_down(\"left\", () => {\n        this.cancelDrag();\n        this.pressed = "),
    [(MOVE_013, after_first_line(MOVE_013, "        this.dragOver(w, cx);\n")),
     (MOVE_011, after_first_line(MOVE_011, "        this.dragOver(w, cx);\n"))],
    ("      .on_mouse_up(\"left\", (_e, cx) => {\n        const from = this.pressed;",
     "      .on_mouse_up(\"left\", (_e, cx) => {\n"
     "        if (this.drop(w, cx)) { this.pressed = null; this.over = null; return; }\n"
     "        const from = this.pressed;"),
    # 목록 안 빈 곳에서 놓음 / 목록 밖으로 나감 / 밖을 누름 = 취소 (끌기 상태가 남아 나중 클릭에 옮겨지지 않게)
    (LIST_UP,
     ".on_mouse_up(\"left\", (_e, cx) => { this.pressed = null; this.cancelDrag(); cx.notify(); })\n"
     "        .on_hover((hovered, cx) => { if (!hovered && this.cancelDrag()) cx.notify(); })\n"
     "        .on_mouse_down_out((_e, cx) => { if (this.cancelDrag()) cx.notify(); })"),
]

NEEDED = ("agents", "focused", "layout", "notify", "hc", "shared", "setShared", "machines")


def build(src: str) -> str:
    """원본 spaces main.js → my-spaces main.js (트리 + 끌어 옮기기, 한 번에)."""
    src = apply_patches(src, TREE_PATCHES, BASE)
    src = apply_patches(src, DRAG_PATCHES, BASE)
    return done_hold.apply(ensure_imports(src, NEEDED), BASE)


def install() -> None:
    target = ensure_own_layout()
    changed = rebuild(BASE, CLONE, build)
    n = point_layout(target, BASE, CLONE)
    print("적용 완료: 레이아웃", target, "/ spaces → my-spaces 연결", n, "곳", "(코드 고침)" if changed else "(코드 변경 없음)")


def remove() -> None:
    target = ensure_own_layout()
    print("되돌림:", point_layout(target, CLONE, BASE), "곳 (레이아웃 " + target + ")")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install()
