// [herdr-use resume-all] 재부팅 뒤 셸로만 돌아온 Claude 세션을 골라 한 번에 이어한다.
//
// 재부팅·로그아웃·core 재시작으로 잃은 터미널은 같은 주소·이름표로 셸만 다시 뜬다(원래 명령은 안 돌림).
// 플러그인 훅(hooks/label_session.py)이 붙인 claude.session / claude.project 이름표는 남으므로,
// "지금은 에이전트가 안 도는 셸 + 세션 이름표 있음" 인 이 PC 터미널을 후보로 보여 주고,
// 고른 것마다 그 셸에 `claude --resume <id> [권한 옵션]` 을 입력한다(탭 자리·이름은 그대로).
//
// 대화 기록(~/.claude/projects/<project>/<id>.jsonl)은 read_sessions.ps1 이 읽는다(읽기만 함):
//   마지막 답변 시각, 시작 폴더, 권한 모드(한 번이라도 bypassPermissions 였으면 --dangerously-skip-permissions).
// 열 때: my-tabs 의 Resume 버튼 → openOverlay({ mod: "resume-all", kind: "dialog", ... }).
// 줄마다 `삭제`: 일부러 끈(Ctrl+C) 세션은 그 터미널의 세션 이름표를 지워 목록·버튼 숫자에서 뺀다.
//   탭·셸·대화 기록(.jsonl)은 그대로 — 나중에 claude 안 /resume 으로 여전히 이어할 수 있다.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { terminals, panes, spaces, exec, hc, appHome, props, closeOverlay, theme, notify, checking } from "herdr";

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROJECT_RE = /^[A-Za-z0-9_-]{1,200}$/;
const READ_TIMEOUT_MS = 60000;
const SEND_TIMEOUT_MS = 20000;
// claude --permission-mode 가 받는 값 중 기본이 아닌 것(bypassPermissions 는 --dangerously-skip-permissions 로)
const MODES = new Set(["acceptEdits", "auto", "dontAsk", "plan"]);
const MODE_LABEL = { bypass: "권한 생략", acceptEdits: "편집 자동 허용", auto: "auto", dontAsk: "dontAsk", plan: "plan", none: "기본" };
const WARN = "#e5a50a";

// my-tabs 의 버튼 숫자와 같은 규칙이어야 한다(그쪽에도 같은 함수가 있음).
export function resumableTerminals() {
  const shown = new Set(panes().filter((p) => p.terminal).map((p) => p.terminal));
  return terminals().filter((t) => t.state === "live" && !String(t.address).includes("/") && !t.status && !t.program?.agent
    && SESSION_RE.test(t.labels?.["claude.session"] ?? "") && PROJECT_RE.test(t.labels?.["claude.project"] ?? "")
    && shown.has(t.address));
}

function candidates() {
  const paneOf = new Map(panes().filter((p) => p.terminal).map((p) => [p.terminal, p]));
  const tabOf = new Map();
  for (const s of spaces()) for (const tb of s.tabs) tabOf.set(tb.id, { space: s, tab: tb });
  return resumableTerminals().map((t) => {
    const p = paneOf.get(t.address), where = tabOf.get(p?.tab);
    return {
      address: t.address,
      session: t.labels["claude.session"],
      project: t.labels["claude.project"],
      shell: String(t.argv?.[0] ?? ""),
      cwd: p?.cwd ?? t.cwd ?? null,
      space: where?.space.name ?? "",
      tab: where?.tab.name ?? t.address,
    };
  });
}

// 삭제 = 이 터미널의 세션 이름표 두 개를 지움(`key=` 는 지우기). 다시 claude 를 켜면 훅이 새로 단다.
export function forgetArgs(address) {
  return ["label", address, "claude.session=", "claude.project="];
}

const slug = (path) => path.replace(/[^A-Za-z0-9]/g, "-");
const samePath = (a, b) => (a ?? "").replace(/[\\/]+$/, "").toLowerCase() === (b ?? "").replace(/[\\/]+$/, "").toLowerCase();
const isCmd = (shell) => /(^|[\\/])cmd(\.exe)?$/i.test(shell);

// 이 셸에 입력할 한 줄. 세션 기록 폴더(claude.project)와 맞는 폴더에서 이어야 claude 가 기록을 찾는다.
export function resumeLine(row) {
  const info = row.info ?? {};
  const want = [row.cwd, info.cwd].find((f) => f && slug(f) === row.project) ?? info.cwd ?? null;
  let cd = "";
  if (want && !samePath(want, row.cwd)) {
    cd = isCmd(row.shell) ? `cd /d "${want}" && ` : `Set-Location -LiteralPath '${want.replace(/'/g, "''")}'; `;
  }
  const flags = info.bypass ? " --dangerously-skip-permissions" : MODES.has(info.mode) ? ` --permission-mode ${info.mode}` : "";
  return `${cd}claude --resume ${row.session}${flags}`;
}

function modeOf(info) {
  if (!info?.found) return null;
  return info.bypass ? "bypass" : MODES.has(info.mode) ? info.mode : "none";
}

function pad(n) { return String(n).padStart(2, "0"); }
function when(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  const ago = mins < 1 ? "방금" : mins < 60 ? `${mins}분 전` : mins < 60 * 24 ? `${Math.round(mins / 60)}시간 전` : `${Math.round(mins / 1440)}일 전`;
  return { text: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`, ago, ms: d.getTime() };
}

export default class ResumeAll extends View {
  init(_props, cx) {
    this.rows = candidates();
    this.checked = new Set();
    this.loading = this.rows.length > 0;
    this.sending = false;
    this.forgetting = new Set();
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (checking() || !this.rows.length) { this.loading = false; return; }
    cx.spawn(async (cx) => {
      try {
        const script = `${appHome()}\\mods\\resume-all\\read_sessions.ps1`;
        const arg = this.rows.map((r) => `${r.session}:${r.project}`).join(",");
        const res = await exec("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-In", arg], { timeout: READ_TIMEOUT_MS });
        const list = JSON.parse(res.stdout.trim() || "[]");
        const by = new Map((Array.isArray(list) ? list : [list]).map((i) => [i.s, i]));
        for (const r of this.rows) {
          r.info = by.get(r.session) ?? { found: false };
          r.time = when(r.info.last) ?? when(r.info.mtime);
          if (r.info.found && !r.info.error) this.checked.add(r.address);
        }
        this.rows.sort((a, b) => (b.time?.ms ?? 0) - (a.time?.ms ?? 0));
        if (res.code !== 0) this.error = (res.stderr || "기록 읽기 실패").trim().slice(0, 200);
      } catch (e) {
        this.error = `기록을 못 읽음: ${String(e?.message ?? e).slice(0, 200)}`;
        for (const r of this.rows) r.info = r.info ?? { found: false };
      }
      this.loading = false;
      cx.notify();
    });
  }

  usable(r) { return Boolean(r.info?.found && !r.info.error); }

  toggle(r) {
    if (!this.usable(r) || this.sending) return;
    if (this.checked.has(r.address)) this.checked.delete(r.address); else this.checked.add(r.address);
  }

  toggleAll() {
    const usable = this.rows.filter((r) => this.usable(r));
    if (usable.every((r) => this.checked.has(r.address))) this.checked.clear();
    else for (const r of usable) this.checked.add(r.address);
  }

  resume(cx) {
    if (this.loading || this.sending) return;
    const picked = this.rows.filter((r) => this.usable(r) && this.checked.has(r.address));
    if (!picked.length) return;
    this.sending = true;
    cx.notify();
    // 창이 닫히면 진행 중인 호출이 취소되므로, 다 보낸 뒤에 닫는다.
    cx.spawn(async () => {
      const results = await Promise.all(picked.map(async (r) => {
        try {
          const res = await hc(["send", r.address, resumeLine(r)]);
          return res.code === 0 ? null : `${r.tab}: ${(res.stderr || res.stdout || `종료 코드 ${res.code}`).trim().slice(0, 80)}`;
        } catch (e) { return `${r.tab}: ${String(e?.message ?? e).slice(0, 80)}`; }
      }));
      const failed = results.filter(Boolean);
      const ok = picked.length - failed.length;
      if (failed.length) notify({ title: `이어하기 ${ok}개 성공 · ${failed.length}개 실패`, body: failed.join("\n"), level: "warning", timeout: 12000 });
      else notify({ title: `Claude 세션 ${ok}개를 이어합니다`, body: picked.map((r) => r.tab).join(", "), level: "success" });
      closeOverlay(props().overlay);
    });
  }

  forget(r, cx) {
    if (this.sending || this.forgetting.has(r.address)) return;
    this.forgetting.add(r.address);
    cx.notify();
    cx.spawn(async (cx) => {
      let failed = null;
      try {
        const res = await hc(forgetArgs(r.address));
        if (res.code !== 0) failed = (res.stderr || res.stdout || `종료 코드 ${res.code}`).trim().slice(0, 120);
      } catch (e) { failed = String(e?.message ?? e).slice(0, 120); }
      this.forgetting.delete(r.address);
      if (failed) notify({ title: `${r.tab}: 삭제 실패`, body: failed, level: "warning", timeout: 12000 });
      else {
        this.rows = this.rows.filter((x) => x.address !== r.address);
        this.checked.delete(r.address);
      }
      cx.notify();
    });
  }

  checkbox(on, enabled) {
    const t = theme();
    return div().size(16).flex_none().rounded(4).border_1().border_color(on ? t.accent : t.input)
      .bg(on ? t.accent : t.background).opacity(enabled ? 1 : 0.4).flex().items_center().justify_center()
      .when(on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(12).text_color(t.solid_foreground)));
  }

  row(r) {
    const t = theme();
    const usable = this.usable(r), on = usable && this.checked.has(r.address);
    const mode = modeOf(r.info);
    const elsewhere = usable && r.info.cwd && !samePath(r.info.cwd, r.cwd) && slug(r.cwd ?? "") !== r.project;
    const detail = this.loading ? "기록 읽는 중…"
      : !r.info?.found ? "대화 기록 없음 — 이어할 수 없음"
      : r.info.error ? `기록 읽기 오류 — ${r.info.error}`
      : r.time ? `마지막 답변 ${r.time.text} · ${r.time.ago}` : "답변 기록 없음";
    return h_flex().id(`row-${r.address}`).min_h(48).px(10).py(6).gap(10).items_center().rounded(7).flex_none()
      .when(usable && !this.sending, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { this.toggle(r); cx.notify(); })
      .child(this.checkbox(on, usable))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().text_color(t.dim).flex_none().child(r.space ? `${r.space} /` : ""))
          .child(div().truncate().min_w(0).text_color(usable ? t.foreground : t.dim).font_semibold().child(r.tab)))
        .child(div().text_size(11.5).truncate().text_color(!this.loading && !usable ? WARN : t.muted).child(detail))
        .when(Boolean(elsewhere), (el) => el.child(div().text_size(11).truncate().text_color(t.dim).child(`시작 폴더로 옮겨서 이어함: ${r.info.cwd}`))))
      .when(Boolean(mode), (el) => el.child(div().flex_none().px(7).h(20).rounded(10).flex().items_center().text_size(11)
        .bg(mode === "bypass" ? t.raised : t.chrome).text_color(mode === "bypass" ? t.foreground : t.muted).child(MODE_LABEL[mode] ?? mode)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(r.address))
      .child(this.forgetButton(r));
  }

  forgetButton(r) {
    const t = theme();
    const busy = this.forgetting.has(r.address), enabled = !busy && !this.sending;
    return div().id(`forget-${r.address}`).flex_none().h(24).px(8).rounded(6).flex().items_center().text_size(11.5)
      .border_1().border_color(t.input).text_color(t.muted).opacity(enabled ? 1 : 0.45)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.text_color(WARN).border_color(WARN)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); if (enabled) this.forget(r, cx); })
      .child(busy ? "삭제 중…" : "삭제");
  }

  render() {
    const t = theme();
    const n = [...this.checked].filter((a) => this.rows.some((r) => r.address === a && this.usable(r))).length;
    const button = (id, label, primary, enabled, onClick) =>
      h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1()
        .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
        .opacity(enabled ? 1 : 0.45).when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)))
        .on_click((_e, cx) => { if (enabled) onClick(cx); }).child(label);
    const anyUsable = this.rows.some((r) => this.usable(r));
    return v_flex().id("resume-all").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.resume(cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(16).gap(10).rounded(8).bg(t.popover).text_size(13)
      .child(h_flex().items_center().gap(8)
        .child(svg("mods/resume-all/resume.svg").size(16).text_color(t.foreground))
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("종료된 Claude 세션 이어하기"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(12).text_color(t.muted).child(this.rows.length
        ? "재부팅 등으로 셸만 남은 탭입니다. 이어할 세션을 고르면 각 탭에서 claude --resume 을 실행합니다. 일부러 끈 세션은 '삭제'로 목록에서 뺍니다(탭·대화 기록은 남음)."
        : "이어할 세션이 없습니다. (claude 가 꺼지고 셸만 남은 탭이 없음)"))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(WARN).child(this.error)))
      .child(v_flex().flex_1().min_h(0).gap(2).overflow_y_scrollbar().children(this.rows.map((r) => this.row(r))))
      .child(h_flex().items_center().gap(8).text_size(12)
        .when(this.rows.length > 1, (el) => el.child(button("all", "전체 선택/해제", false, anyUsable && !this.loading && !this.sending, (cx) => { this.toggleAll(); cx.notify(); })))
        .child(div().flex_1())
        .child(button("no", "취소", false, !this.sending, () => closeOverlay(props().overlay)))
        .child(button("yes", this.sending ? "이어하는 중…" : this.loading ? "기록 읽는 중…" : `선택한 ${n}개 이어하기`, true,
          !this.loading && !this.sending && n > 0, (cx) => this.resume(cx))));
  }
}
