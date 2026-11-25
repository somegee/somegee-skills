// [herdr-custom claude-notes] 지금 보고 있는 터미널의 Claude 세션 노트(notes mod)를 herdr 창에서 본다 — 보기 전용.
//
// notes mod(0.22.0~)는 herdr 터미널 안에서 켜지면 TUI 옆 창을 열지 않고, 상태 파일
//   <home>/.claude/notes-data/live/<세션 id>.json = { state, at, file }
// 에 노트 파일 위치(file, notes-data 기준 상대 경로)를 남긴다. 이 mod 는
//   보고 있는 터미널 → 이름표 claude.session(herdr-desktop 훅) → 상태 파일의 file → 그 노트 파일
// 순서로 읽는다. 상태 파일이 없으면(옛 notes) sessions/<id>.json → _all.json 순서로 찾는다.
// 원격 기기 터미널(주소 'server/t12' 꼴)은 readTextFile(..., { on: 기기 }) 로 그 기기 홈 기준 상대 경로를 읽는다.
// 자리: 오른쪽 패널(Files·Changes 와 같은 stack 'panel-body' 의 한 칸). my-tabs 의 Notes 버튼이 그 칸을 펴고 접는다.
// 팝업(dialog)으로 열어도 그려지게 남겨 둔다(그땐 Esc 로 닫힘).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { focused, terminals, readTextFile, appHome, props, closeOverlay, theme } from "herdr";
import * as herdrApi from "herdr";

// checking() 은 앱 0.1.16 부터 있다. 이름으로 import 하면 0.1.15 에선 mod 가 아예 안 뜬다 → 없으면 늘 false.
const checking = typeof herdrApi.checking === "function" ? herdrApi.checking : () => false;

const REFRESH_MS = 2000;
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_RE = /^(?:_all|sessions\/[A-Za-z0-9-]{1,80}|[A-Za-z0-9-]{1,200})\.json$/;
const MACHINE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const BLOCKED = "#e5484d";
const WAITING = "#e5a50a";
const DONE = "#30a46c";
const LIVE_STALE_MS = 180000;

// ---- 순수 함수(시험 대상) ----

// 터미널 주소 → { machine, id }. 'homeserver/t12' 면 원격, 't12' 면 이 PC.
export function splitAddress(address) {
  const s = String(address ?? "");
  const i = s.indexOf("/");
  if (i < 0) return { machine: null, id: s };
  const machine = s.slice(0, i);
  return MACHINE_RE.test(machine) ? { machine, id: s.slice(i + 1) } : { machine: null, id: s };
}

// 이 PC 의 홈: appHome() = <홈>\.config\herdr-app (HERDR_APP_HOME 을 바꾼 PC 는 못 맞춘다 → null).
export function homeFromAppHome(app) {
  const m = String(app ?? "").match(/^(.*?)[\\/]\.config[\\/]herdr-app[\\/]?$/);
  return m ? m[1] : null;
}

// notes-data 안 상대 경로 → 읽을 경로. 원격은 그 기기 홈 기준 상대 경로, 이 PC 는 절대 경로.
export function dataPath(rel, machine, home) {
  if (machine) return ".claude/notes-data/" + rel;
  return home ? home + "\\.claude\\notes-data\\" + rel.replace(/\//g, "\\") : null;
}

// 읽을 노트 파일 후보(앞에서부터). 상태 파일의 file 이 형식에 맞으면 그것만.
export function noteCandidates(session, liveText) {
  try {
    const f = JSON.parse(liveText ?? "null")?.file;
    if (typeof f === "string" && FILE_RE.test(f)) return [f];
  } catch { /* 깨진 상태 파일 */ }
  return ["sessions/" + session + ".json", "_all.json"];
}

export function liveState(liveText, nowMs) {
  try {
    const v = JSON.parse(liveText ?? "null");
    if (!v || typeof v.at !== "string" || nowMs - Date.parse(v.at) > LIVE_STALE_MS) return "idle";
    return v.state === "working" || v.state === "ask" ? v.state : "idle";
  } catch { return "idle"; }
}

const text = (v) => (typeof v === "string" ? v : "");
const toItem = (i) => ({
  text: text(i?.text), isDone: i?.isDone === true,
  status: i?.status === "blocked" || i?.status === "waiting" ? i.status : null,
  note: text(i?.note), resolved: text(i?.resolved),
});

export function parseBook(raw) {
  const book = JSON.parse(raw);
  const tabs = Array.isArray(book?.tabs) ? book.tabs : [];
  return tabs.filter((t) => typeof t?.title === "string").map((t) => ({
    title: t.title, goal: text(t.goal), doneWhen: text(t.doneWhen), memo: text(t.memo),
    items: Array.isArray(t.items) ? t.items.map(toItem) : [],
    results: Array.isArray(t.results) ? t.results.filter((r) => typeof r === "string") : [],
    sessionId: text(t.session?.id), sessionTitle: text(t.session?.title),
    updatedMs: Date.parse(t.updatedAt) || 0,
  }));
}

// 이 세션 탭을 최근 것부터, 그다음 다른 세션 탭(최근 것부터).
export function orderTabs(tabs, session) {
  const byRecent = (a, b) => b.updatedMs - a.updatedMs;
  const mine = tabs.filter((t) => t.sessionId === session).sort(byRecent);
  const others = tabs.filter((t) => t.sessionId !== session).sort(byRecent);
  return { mine, others };
}

export function ago(ms, nowMs) {
  const sec = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (!ms || sec < 60) return "방금";
  if (sec < 3600) return Math.floor(sec / 60) + "분 전";
  if (sec < 86400) return Math.floor(sec / 3600) + "시간 전";
  return Math.floor(sec / 86400) + "일 전";
}

// ---- 읽기 ----

function currentTarget() {
  const f = focused();
  const address = f?.terminal ?? f?.shown ?? null;
  if (!address) return { error: "보고 있는 터미널이 없습니다. Claude 탭을 누른 뒤 다시 여세요." };
  const t = terminals().find((x) => x.address === address);
  const session = t?.labels?.["claude.session"];
  if (!session || !SESSION_RE.test(session)) {
    return { address, error: "이 터미널엔 Claude 세션 이름표가 없습니다. (claude 를 이 탭에서 다시 켜면 붙습니다)" };
  }
  return { address, session, title: t?.name || t?.title || address, ...splitAddress(address) };
}

async function readNotes(target) {
  const home = homeFromAppHome(appHome());
  const on = target.machine ? { on: target.machine } : undefined;
  const read = async (rel) => {
    const path = dataPath(rel, target.machine, home);
    if (!path) throw new Error("이 PC 의 홈 폴더를 못 찾았습니다(HERDR_APP_HOME 을 바꾼 경우).");
    return readTextFile(path, on);
  };
  const liveText = await read("live/" + target.session + ".json").catch(() => null);
  for (const rel of noteCandidates(target.session, liveText)) {
    const raw = await read(rel).catch(() => null);
    if (raw) return { tabs: parseBook(raw), file: rel, live: liveState(liveText, Date.now()) };
  }
  return { tabs: [], file: null, live: liveState(liveText, Date.now()) };
}

// ---- 화면 ----

export default class ClaudeNotes extends View {
  init(_props, cx) {
    this.target = null;
    this.data = null;
    this.error = null;
    this.picked = null;
    this.showOthers = false;
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (tcx) => this.refresh(tcx));
  }

  refresh(cx) {
    if (this.busy) return;
    const target = currentTarget();
    // 다른 세션으로 바뀌면 고른 탭을 놓는다.
    if (target.session !== this.target?.session) this.picked = null;
    this.target = target;
    if (target.error) { this.error = target.error; this.data = null; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        this.data = await readNotes(target);
        this.error = null;
      } catch (e) {
        this.error = "노트를 못 읽음: " + String(e?.message ?? e).slice(0, 200);
      }
      this.busy = false;
      cx.notify();
    });
  }

  shownTab() {
    const { mine, others } = orderTabs(this.data?.tabs ?? [], this.target?.session);
    const all = [...mine, ...others];
    return all.find((t) => t.title === this.picked) ?? mine[0] ?? null;
  }

  chip(tab, isMine, isOn) {
    const t = theme();
    const open = tab.items.filter((i) => !i.isDone);
    const mark = open.some((i) => i.status === "blocked") ? "⛔ " : open.some((i) => i.status === "waiting") ? "⏳ "
      : tab.items.length && !open.length ? "✅ " : "";
    return h_flex().id("tab-" + tab.title).h(24).px(9).flex_none().items_center().rounded(6).text_size(12)
      .bg(isOn ? t.selected : t.chrome).text_color(isOn ? t.foreground : isMine ? t.muted : t.dim)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.picked = tab.title; cx.notify(); })
      .child(mark + tab.title + " " + (tab.items.length ? tab.items.filter((i) => i.isDone).length + "/" + tab.items.length : ""));
  }

  section(label, body) {
    const t = theme();
    return v_flex().gap(3).flex_none()
      .child(div().text_size(11).text_color(t.dim).child(label))
      .child(body);
  }

  item(i, n, isNow) {
    const t = theme();
    const color = i.isDone ? t.dim : isNow ? t.foreground : t.muted;
    return v_flex().gap(1).px(6).py(3).rounded(5).flex_none().when(isNow, (el) => el.bg(t.raised))
      .child(h_flex().gap(6).items_start()
        .child(div().flex_none().w(16).text_color(i.isDone ? DONE : isNow ? t.accent : t.dim).child(i.isDone ? "✓" : isNow ? "▶" : "○"))
        .child(div().flex_1().min_w(0).text_color(color).when(i.isDone, (el) => el.line_through()).child(i.text)))
      .when(Boolean(i.status), (el) => el.child(div().pl(22).text_size(11.5).text_color(i.status === "blocked" ? BLOCKED : WAITING)
        .child((i.status === "blocked" ? "⛔ 막힘" : "⏳ 대기") + (i.note ? ": " + i.note : ""))))
      .when(Boolean(i.resolved), (el) => el.child(div().pl(22).text_size(11.5).text_color(t.dim).child("처리: " + i.resolved)));
  }

  body(tab) {
    const t = theme();
    const nowAt = tab.items.findIndex((i) => !i.isDone);
    const lines = (s) => v_flex().gap(1).children(s.split(/\r?\n/).filter(Boolean).map((l) => div().text_color(t.muted).child(l)));
    return v_flex().gap(10)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(15).font_semibold().text_color(t.foreground).truncate().child(tab.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(tab.updatedMs, Date.now()) + " 갱신")))
      .when(Boolean(tab.goal), (el) => el.child(this.section("목표", lines(tab.goal))))
      .when(Boolean(tab.doneWhen), (el) => el.child(this.section("종료 조건", lines(tab.doneWhen))))
      .when(tab.items.length > 0, (el) => el.child(this.section("할 일 " + tab.items.filter((i) => i.isDone).length + "/" + tab.items.length,
        v_flex().gap(1).children(tab.items.map((i, n) => this.item(i, n, n === nowAt))))))
      .when(tab.results.length > 0, (el) => el.child(this.section("결과물", v_flex().gap(1).children(tab.results.map((r) => div().text_color(t.muted).child("· " + r))))))
      .when(Boolean(tab.memo), (el) => el.child(this.section("메모", lines(tab.memo))));
  }

  render() {
    const t = theme();
    const { mine, others } = orderTabs(this.data?.tabs ?? [], this.target?.session);
    const tab = this.shownTab();
    const live = this.data?.live;
    const liveMark = live === "working" ? "● 일하는 중" : live === "ask" ? "💬 답 기다림" : "쉬는 중";
    const overlay = props()?.overlay;
    const where = this.target?.address ? (this.target.machine ? this.target.machine + " · " : "") + (this.target.title ?? "") : "";
    return v_flex().id("claude-notes").track_focus(this.handle)
      .on_key_down((e, cx) => { if (overlay && e.key === "escape") { closeOverlay(overlay); cx.stop_propagation(); } })
      .size_full().min_h(0).p(overlay ? 16 : 12).gap(10).when(Boolean(overlay), (el) => el.rounded(8)).bg(overlay ? t.popover : t.chrome).text_size(13)
      .child(h_flex().items_center().gap(8)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("notes"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(where))
        .when(Boolean(this.data), (el) => el.child(div().flex_none().text_size(11).text_color(live === "working" ? DONE : live === "ask" ? WAITING : t.dim).child(liveMark)))
        .when(Boolean(overlay), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("Esc"))))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(WAITING).child(this.error)))
      .when(!this.error && Boolean(this.data) && !this.data.tabs.length, (el) => el.child(div().text_size(12).text_color(t.muted).child("이 세션엔 아직 노트가 없습니다.")))
      .when(!this.error && !this.data, (el) => el.child(div().text_size(12).text_color(t.dim).child("읽는 중…")))
      .when(mine.length + others.length > 0, (el) => el.child(h_flex().gap(4).flex_wrap()
        .children(mine.map((x) => this.chip(x, true, x === tab)))
        .when(others.length > 0, (row) => row.child(h_flex().id("others").h(24).px(8).items_center().rounded(6).text_size(11.5)
          .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.showOthers = !this.showOthers; cx.notify(); })
          .child(this.showOthers ? "다른 세션 탭 숨기기" : "다른 세션 탭 " + others.length + "개")))
        .when(this.showOthers, (row) => row.children(others.map((x) => this.chip(x, false, x === tab))))))
      .child(v_flex().id("notes-body").flex_1().min_h(0).overflow_y_scrollbar()
        .when(Boolean(tab), (el) => el.child(this.body(tab)))
        .when(!tab && mine.length === 0 && others.length > 0, (el) => el.child(div().text_size(12).text_color(t.muted).child("이 세션이 만든 탭은 없습니다. 위에서 다른 세션 탭을 볼 수 있습니다."))));
  }
}
