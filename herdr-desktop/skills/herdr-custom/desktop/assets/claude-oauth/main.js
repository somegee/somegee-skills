// [herdr-custom claude-oauth] Claude 계정(OAuth 토큰) 전환 팝업 — 서버 백엔드의 보관함·로직을 그대로 쓴다(웹 화면이 쓰는 것과 같은 곳).
//
// 토큰 보관함·반영(서버·이 PC 의 관리용 설정 파일)·사용량 조회는 전부 서버 백엔드에 있다.
// 이 mod 는 설정 파일(.herdr-custom/claude-oauth.json)에 적힌 기기에서 명령을 하나 돌려 그 백엔드에 부탁만 한다:
//   hc exec --on <on> -- <command...> overview | usage [--refresh] | activate <id> | reset | rename <id> <이름> | delete <id>
//   add 는 토큰을 명령줄에 싣지 않으려고 표준입력으로 넘긴다(임시 파일 → PowerShell 이 읽자마자 지우고 hc exec -i 로 흘림).
// 명령은 성공하면 응답 JSON, 실패하면 {"error": "..."} 를 한 줄로 쓴다. 토큰 원문은 화면·응답에 오지 않는다(끝 4자리만).
// 열 때: my-tabs 의 OAuth 버튼 → openOverlay({ mod: "claude-oauth", kind: "dialog", ... }).

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { exec, appHome, props, closeOverlay, theme, checking, readTextFile } from "herdr";
import * as fs from "fs/promises";

const MOD = "claude-oauth";
const CONFIG_NAME = "claude-oauth.json";
const MACHINE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const ARG_RE = /^[A-Za-z0-9._\/:=@+-]{1,200}$/;
const MAX_COMMAND_PARTS = 16;
const MAX_LABEL_CHARS = 30;
const READ_TIMEOUT_S = 60;     // 사용량은 토큰마다 짧은 호출이 나갈 수 있다
const WRITE_TIMEOUT_S = 100;   // 토큰 확인·서버 반영(SSH)
const BUSY_POLL_MS = 4000;     // PC 반영 중일 때만 다시 읽는다(부를 때마다 서버에서 명령이 하나 뜨므로 웹보다 느슨히)
const DELETE_ARM_MS = 3000;
const TICK_MS = 250;
const EXEC_GRACE_MS = 15000;   // hc exec --timeout 위에 얹는 여유(연결·프로세스 띄우기)
const TMP_PREFIX = "oauth-add-";
const WARN_PCT = 70;
const DANGER_PCT = 90;
const WARN = "#e5a50a";
const DANGER = "#e5484d";
const OK = "#30a46c";
const MACHINES = [["server", "서버"], ["pc", "로컬PC"]];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// ---- 설정·명령 ----

const tmpDir = () => `${appHome()}\\.herdr-custom\\tmp`;
const configPath = () => `${appHome()}\\.herdr-custom\\${CONFIG_NAME}`;

export function parseConfig(text) {
  if (!text) throw new Error("설정 파일이 없습니다");
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("설정 파일이 JSON 이 아닙니다"); }
  const on = raw?.on, command = raw?.command;
  if (typeof on !== "string" || !MACHINE_RE.test(on)) throw new Error("설정의 on(기기 이름)이 올바르지 않습니다");
  if (!Array.isArray(command) || !command.length || command.length > MAX_COMMAND_PARTS
    || !command.every((a) => typeof a === "string" && ARG_RE.test(a))) {
    throw new Error("설정의 command(서버에서 돌릴 명령)가 올바르지 않습니다");
  }
  return { on, command };
}

export function execArgs(cfg, args, timeoutS, withStdin = false) {
  return ["exec", ...(withStdin ? ["-i"] : []), "--on", cfg.on, "--timeout", String(timeoutS), "--", ...cfg.command, ...args];
}

// hc exec 의 출력 → 응답 객체. 명령의 JSON 한 줄을 먼저 보고, 없으면 hc 자체 오류 문구를 꺼낸다.
export function parseResult(res) {
  const lines = String(res?.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  let out = null;
  for (let i = lines.length - 1; i >= 0 && !out; i--) {  // 끝에서부터 첫 JSON 줄 — 앞뒤 잡글(경고·진행 표시)은 건너뛴다
    try { const v = JSON.parse(lines[i]); if (v && typeof v === "object" && !Array.isArray(v)) out = v; } catch { /* 잡글 */ }
  }
  if (out) {
    if (typeof out.error === "string") throw new Error(out.error);
    if (res.code === 0) return out;
  }
  const err = String(res?.stderr ?? "").trim() || lines.join(" ");
  let message = err;
  try { message = JSON.parse(err)?.error?.message ?? err; } catch { /* 그냥 글 */ }
  throw new Error((message || `종료 코드 ${res?.code}`).slice(0, 200));
}

// PowerShell -EncodedCommand 는 UTF-16LE 의 base64 를 받는다 — 따옴표 처리 문제를 통째로 피하려고 쓴다.
export function encodePowerShell(script) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = [];
  for (let i = 0; i < script.length; i++) { const c = script.charCodeAt(i); bytes.push(c & 255, c >> 8); }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? A[n & 63] : "=");
  }
  return out;
}

const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// JSON 을 ASCII 로만 — PowerShell 이 네이티브 명령에 흘릴 때 인코딩이 바뀌어도 글자가 안 깨지게
export function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function addScript(cfg, file) {
  const args = execArgs(cfg, ["add"], WRITE_TIMEOUT_S, true).map(psQuote).join(" ");
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false",
    "$OutputEncoding = New-Object Text.UTF8Encoding $false",
    `$f = ${psQuote(file)}`,
    "try { $body = [IO.File]::ReadAllText($f) } finally { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }",
    `$body | & hc ${args}`,
    "exit $LASTEXITCODE",
  ].join("\n");
}

// ---- 응답 → 화면 값 ----

function machineState(raw) {
  if (!raw || typeof raw.state !== "string") return null;
  return { state: raw.state, error: typeof raw.error === "string" ? raw.error : null };
}

export function toOverview(raw) {
  const tokens = Array.isArray(raw?.tokens) ? raw.tokens : [];
  return {
    tokens: tokens.map((t) => ({ id: String(t?.id ?? ""), label: String(t?.label ?? ""), hint: String(t?.hint ?? "") })),
    activeId: typeof raw?.active_id === "string" ? raw.active_id : null,
    machines: Object.fromEntries(MACHINES.map(([m]) => [m, machineState(raw?.machines?.[m])])),
  };
}

function toWindow(raw) {
  return raw && typeof raw.pct === "number" ? { pct: raw.pct, resetsAt: typeof raw.resets_at === "string" ? raw.resets_at : null } : null;
}

function toUsage(raw) {
  return {
    ok: raw?.ok === true,
    fiveHour: toWindow(raw?.five_hour),
    sevenDay: toWindow(raw?.seven_day),
    checkedAt: Number(raw?.checked_at) || 0,
    error: typeof raw?.error === "string" ? raw.error : null,
  };
}

export function toUsageMap(raw) {
  const tokens = raw?.tokens && typeof raw.tokens === "object" ? raw.tokens : {};
  return { tokens: Object.fromEntries(Object.entries(tokens).map(([id, u]) => [id, toUsage(u)])), login: toUsage(raw?.login) };
}

export function isBusy(overview) {
  return Boolean(overview) && Object.values(overview.machines).some((m) => m?.state === "pending" || m?.state === "waking");
}

const pad = (n) => String(n).padStart(2, "0");

export function resetText(iso, withWeekday) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${withWeekday ? WEEKDAYS[d.getDay()] + " " : ""}${pad(d.getHours())}:${pad(d.getMinutes())} 초기화`;
}

function checkedText(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} 기준`;
}

// ---- 여유 순 정렬·바꾸기 추천·남은 시간 (웹 화면과 같은 규칙) ----
// 5시간 칸은 값이 올 때만 있다 — Ultra 계정은 5시간 한도가 없어 늘 null.

export const SUGGEST_SWITCH_PCT = 70;
export const BLOCKED_PCT = 100;
const MINUTE_MS = 60000;

function windowsOf(usage) {
  if (!usage?.ok) return [];
  return [usage.fiveHour, usage.sevenDay].filter((w) => w !== null);
}

// 가장 많이 찬 한도 칸 — 이 칸이 계정을 막는다
export function bindingWindow(usage) {
  return windowsOf(usage).reduce((worst, w) => (worst === null || w.pct > worst.pct ? w : worst), null);
}

export function usedPct(usage) {
  const w = bindingWindow(usage);
  return w === null ? null : Math.min(100, Math.max(0, w.pct));
}

export function isBlocked(usage) {
  const pct = usedPct(usage);
  return pct !== null && pct >= BLOCKED_PCT;
}

// 여유 많은 순(쓴 % 낮은 순). 값을 모르는 계정은 맨 뒤, 같으면 원래 순서
export function sortByHeadroom(entries) {
  return entries
    .map((entry, index) => ({ entry, index, pct: usedPct(entry.usage) }))
    .sort((a, b) => {
      if (a.pct === null && b.pct === null) return a.index - b.index;
      if (a.pct === null) return 1;
      if (b.pct === null) return -1;
      return a.pct - b.pct || a.index - b.index;
    })
    .map(({ entry }) => entry);
}

// 지금 계정이 기준을 넘었고, 그보다 여유 있고 막히지 않은 계정이 있으면 가장 여유 있는 것
export function pickSwitchTarget(entries, activeKey) {
  const current = entries.find((e) => e.key === activeKey);
  const currentPct = current ? usedPct(current.usage) : null;
  if (!current || currentPct === null || currentPct < SUGGEST_SWITCH_PCT) return null;
  const target = sortByHeadroom(entries).find((e) => {
    const pct = usedPct(e.usage);
    return e.key !== activeKey && pct !== null && pct < BLOCKED_PCT && pct < currentPct;
  });
  return target ? { current, target } : null;
}

function parseIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "토 18:00"
export function resetAtText(iso) {
  const d = parseIso(iso);
  return d ? `${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}` : null;
}

// "5일 1시간 뒤" · "9시간 27분 뒤" · "12분 뒤" · 지났으면 "곧"
export function untilText(iso, now) {
  const d = parseIso(iso);
  if (!d) return null;
  const minutes = Math.round((d.getTime() - now) / MINUTE_MS);
  if (minutes <= 0) return "곧";
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60;
  if (days > 0) return `${days}일 ${hours}시간 뒤`;
  if (hours > 0) return `${hours}시간 ${mins}분 뒤`;
  return `${mins}분 뒤`;
}

// 한 줄 요약 — "5일 1시간 뒤 초기화 · 5시간 12%" / "토 18:00까지 막힘"
export function summaryText(usage, loading, now) {
  if (!usage) return loading ? "불러오는 중…" : "사용량 정보 없음";
  if (!usage.ok) return usage.error ?? "사용량을 가져오지 못했습니다";
  const binding = bindingWindow(usage);
  if (!binding) return "한도 정보 없음";
  if (isBlocked(usage)) {
    const at = resetAtText(binding.resetsAt);
    return at ? `${at}까지 막힘` : "한도를 다 씀";
  }
  const until = untilText(binding.resetsAt, now);
  const five = usage.fiveHour ? ` · 5시간 ${Math.round(usage.fiveHour.pct)}%` : "";
  return `${until ? `${until} 초기화` : "초기화 시각 모름"}${five}`;
}

// 목록 한 줄의 재료 — 로그인 계정과 저장한 토큰을 같은 꼴로 묶어 여유 순으로
export const LOGIN_KEY = "login";
export function buildEntries(overview, usage) {
  const login = { key: LOGIN_KEY, label: "로그인 계정", detail: "기본 · 서버 기준", usage: usage?.login, token: null };
  const tokens = overview.tokens.map((tk) => ({ key: tk.id, label: tk.label, detail: "····" + tk.hint, usage: usage?.tokens[tk.id], token: tk }));
  return sortByHeadroom([login, ...tokens]);
}

function chip(state) {
  switch (state?.state) {
    case "applied": return { text: "반영됨", color: OK };
    case "pending": return { text: "반영 중…", color: WARN };
    case "waking": return { text: "깨우는 중…", color: WARN };
    case "failed": return { text: "실패", color: DANGER };
    default: return { text: "기록 없음", color: null };
  }
}

const meterColor = (pct, t) => (pct >= DANGER_PCT ? DANGER : pct >= WARN_PCT ? WARN : t.accent);
const errText = (e) => String(e?.message ?? e).slice(0, 200);

export default class ClaudeOAuth extends View {
  init(_props, cx) {
    this.cfg = null;
    this.cfgError = null;
    this.overview = null;
    this.usage = null;
    this.loadError = null;
    this.usageLoading = false;
    this.refreshing = false;
    this.action = null;          // { kind, id } — 지금 돌고 있는 바꾸기
    this.actionError = null;
    this.polling = false;
    this.expanded = null;        // 펼친 줄(한 번에 하나)
    this.editing = null;         // 이름 고치는 토큰 id
    this.renameInput = null;
    this.armed = null;           // 지우기 한 번 누른 토큰 id
    this.armedAt = 0;
    this.adding = false;
    this.addError = null;
    this.labelInput = InputState.new({ placeholder: "예: 회사 계정" });
    this.tokenInput = InputState.new({ placeholder: "sk-ant-oat01-…" });
    this.tokenInput.set_masked(true);
    for (const input of [this.labelInput, this.tokenInput]) {
      input.on("change", (_e, cx) => cx.notify());
      input.on("submit", (_e, cx) => this.add(cx));
    }
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    if (checking()) return;
    cx.spawn(async (cx) => {
      await this.cleanTmp();
      try {
        this.cfg = parseConfig(await readTextFile(configPath()));
      } catch (e) {
        this.cfgError = errText(e);
        cx.notify();
        return;
      }
      cx.notify();
      await Promise.all([this.loadOverview(cx), this.loadUsage(cx, false)]);
    });
  }

  close() { closeOverlay(props().overlay); }

  // exec 는 시간 제한이 문서에 있다(hc() 는 없음) — hc exec 의 --timeout 보다 조금 길게
  async call(args, timeoutS) {
    return parseResult(await exec("hc", execArgs(this.cfg, args, timeoutS), { timeout: timeoutS * 1000 + EXEC_GRACE_MS }));
  }

  // 지난번 토큰 추가가 앱 종료 등으로 끊겨 남은 임시 파일(평문 토큰)을 지운다
  async cleanTmp() {
    try {
      for (const name of await fs.readdir(tmpDir())) {
        if (name.startsWith(TMP_PREFIX)) { try { await fs.unlink(`${tmpDir()}\\${name}`); } catch { /* 다음에 */ } }
      }
    } catch { /* 폴더 없음 */ }
  }

  async loadOverview(cx) {
    try {
      this.overview = toOverview(await this.call(["overview"], READ_TIMEOUT_S));
      this.loadError = null;
    } catch (e) {
      if (!this.overview) this.loadError = errText(e);
    }
    cx.notify();
  }

  async loadUsage(cx, refresh) {
    this.usageLoading = true;
    if (refresh) this.refreshing = true;
    cx.notify();
    try {
      this.usage = toUsageMap(await this.call(refresh ? ["usage", "--refresh"] : ["usage"], READ_TIMEOUT_S));
    } catch (e) {
      if (refresh || !this.usage) this.actionError = `사용량: ${errText(e)}`;
    }
    this.usageLoading = false;
    this.refreshing = false;
    cx.notify();
  }

  tick(cx) {
    if (this.armed && Date.now() - this.armedAt > DELETE_ARM_MS) { this.armed = null; cx.notify(); }
    if (this.cfg && !this.polling && !this.action && isBusy(this.overview) && Date.now() - (this.polledAt ?? 0) > BUSY_POLL_MS) {
      this.polling = true;
      this.polledAt = Date.now();
      cx.spawn(async (cx) => { await this.loadOverview(cx); this.polling = false; });
    }
  }

  busy() { return Boolean(this.action) || isBusy(this.overview); }

  // 보관함을 바꾸는 동작 — 응답(새 보관함)으로 화면을 갈아 끼운다
  run(cx, kind, id, work) {
    if (this.action || !this.cfg) return;
    this.action = { kind, id };
    this.actionError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let failed = false;
      try {
        this.overview = toOverview(await work());
      } catch (e) {
        this.actionError = errText(e);
        failed = true;
      }
      this.action = null;
      cx.notify();
      if (failed) await this.loadOverview(cx);  // 응답만 끊기고 서버엔 반영됐을 수 있다 — 실제 상태로 맞춘다
    });
  }

  activate(cx, id) { this.run(cx, "activate", id, () => this.call(["activate", id], WRITE_TIMEOUT_S)); }
  reset(cx) { this.run(cx, "reset", null, () => this.call(["reset"], WRITE_TIMEOUT_S)); }

  remove(cx, id) {
    if (this.armed !== id) { this.armed = id; this.armedAt = Date.now(); cx.notify(); return; }
    this.armed = null;
    this.run(cx, "delete", id, () => this.call(["delete", id], WRITE_TIMEOUT_S));
  }

  startRename(cx, token) {
    if (this.busy()) return;
    this.editing = token.id;
    this.renameInput = InputState.new({ value: token.label });
    this.renameInput.set_selected_range({ start: 0, end: token.label.length });
    this.renameInput.on("submit", (_e, cx) => this.saveRename(cx, token));
    this.renameInput.focus();
    cx.notify();
  }

  saveRename(cx, token) {
    const label = this.renameInput?.value().replace(/\s+/g, " ").trim() ?? "";
    this.editing = null;
    this.renameInput = null;
    if (!label || label === token.label) { cx.notify(); return; }
    if (label.length > MAX_LABEL_CHARS) { this.actionError = `이름은 ${MAX_LABEL_CHARS}자까지입니다`; cx.notify(); return; }
    this.run(cx, "rename", token.id, () => this.call(["rename", token.id, "--", label], WRITE_TIMEOUT_S));
  }

  cancelEdit(cx) { this.editing = null; this.renameInput = null; cx.notify(); }

  openAdd(cx) {
    this.adding = true;
    this.addError = null;
    this.labelInput.set_value("");
    this.tokenInput.set_value("");
    this.labelInput.focus();
    cx.notify();
  }

  closeAdd(cx) {
    if (this.action?.kind === "add") return;  // 확인 중엔 닫지 않는다(실패 문구를 보여 줄 곳이 없어짐)
    this.adding = false; this.addError = null; this.handle.focus(); cx.notify(); }

  add(cx) {
    const label = this.labelInput.value().trim(), token = this.tokenInput.value().trim();
    if (!label || !token || this.action || !this.cfg) return;
    this.action = { kind: "add", id: null };
    this.addError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const dir = tmpDir();
      const file = `${dir}\\${TMP_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}.json`;
      let failed = false;
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(file, asciiJson({ label, token }));
        const res = await exec("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(addScript(this.cfg, file))],
          { timeout: (WRITE_TIMEOUT_S + 20) * 1000 });
        this.overview = toOverview(parseResult(res));
        this.adding = false;
        this.tokenInput.set_value("");
        this.labelInput.set_value("");
        this.handle.focus();
        cx.spawn(async (cx) => this.loadUsage(cx, false));
      } catch (e) {
        this.addError = errText(e);
        failed = true;
      } finally {
        try { await fs.unlink(file); } catch { /* PowerShell 이 이미 지움 */ }
      }
      this.action = null;
      cx.notify();
      if (failed) await this.loadOverview(cx);  // 응답만 끊기고 저장은 됐을 수 있다
    });
  }

  key(e, cx) {
    if (e.key !== "escape") return;
    if (this.editing) this.cancelEdit(cx);
    else if (this.adding) this.closeAdd(cx);
    else this.close();
    cx.stop_propagation();
  }

  // ---- 그리기 ----

  button(id, label, { primary = false, enabled = true, danger = false, onClick }) {
    const t = theme();
    const fg = primary ? t.solid_foreground : danger ? "#ffffff" : t.foreground;
    const bg = primary ? t.solid : danger ? DANGER : t.raised;
    return h_flex().id(id).h(28).px(11).gap(5).flex_none().items_center().rounded(7).border_1()
      .border_color(primary ? t.solid : danger ? DANGER : t.input).bg(bg).text_color(fg).text_size(12)
      .opacity(enabled ? 1 : 0.45).when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); if (enabled) onClick(cx); }).child(label);
  }

  statusCard() {
    const t = theme(), o = this.overview;
    const active = o?.activeId ? o.tokens.find((x) => x.id === o.activeId)?.label ?? "로그인 계정" : "로그인 계정";
    const failures = MACHINES.filter(([m]) => o?.machines[m]?.state === "failed");
    const retry = (cx) => (o?.activeId ? this.activate(cx, o.activeId) : this.reset(cx));
    return v_flex().gap(8).p(12).rounded(10).bg(t.surface).flex_none()
      .child(h_flex().items_center().gap(8)
        .child(div().text_size(11.5).text_color(t.muted).child("지금 새 세션이 쓰는 계정"))
        .child(div().flex_1())
        .child(div().text_size(13.5).font_semibold().truncate().text_color(t.foreground).child(o ? active : "…")))
      .child(h_flex().gap(6).children(MACHINES.map(([m, name]) => {
        const c = chip(o?.machines[m]);
        return h_flex().h(24).px(9).gap(6).items_center().rounded(12).bg(t.raised).text_size(11.5)
          .child(div().size(7).rounded(4).bg(c.color ?? t.dim))
          .child(div().text_color(t.foreground).child(name))
          .child(div().text_color(t.muted).child(c.text));
      })))
      .when(failures.length > 0, (el) => el.child(h_flex().gap(8).items_start().p(8).rounded(8).bg(t.raised)
        .child(v_flex().flex_1().min_w(0).gap(2).children(failures.map(([m, name]) =>
          div().text_size(11.5).text_color(DANGER).child(`${name}: ${o.machines[m]?.error ?? "반영하지 못했습니다"}`))))
        .child(this.button("retry", "다시 시도", { enabled: !this.busy(), onClick: retry }))))
      .when(Boolean(this.actionError), (el) => el.child(div().text_size(11.5).text_color(DANGER).child(this.actionError)));
  }

  meter(label, win, withWeekday) {
    const t = theme();
    const pct = Math.min(100, Math.max(0, win.pct));
    return v_flex().flex_1().min_w(0).gap(4)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(11).text_color(t.muted).child(label))
        .child(div().text_size(11).text_color(t.foreground).child(`${Math.round(pct)}%`)))
      .child(div().w_full().h(6).rounded(3).bg(t.border)
        .child(div().h(6).rounded(3).w(`${pct}%`).bg(meterColor(pct, t))))
      .child(div().h(14).text_size(10.5).text_color(t.dim).child(resetText(win.resetsAt, withWeekday)));
  }

  // 펼친 칸의 한도별 막대 — 5시간 칸은 값이 올 때만
  details(u) {
    if (!u?.ok) return null;
    const meters = [u.fiveHour && this.meter("5시간", u.fiveHour, false), u.sevenDay && this.meter("7일", u.sevenDay, true)].filter(Boolean);
    return meters.length ? h_flex().gap(16).children(meters) : null;
  }

  suggestionCard(s) {
    const t = theme();
    const curPct = usedPct(s.current.usage) ?? 0, tgtPct = usedPct(s.target.usage) ?? 0;
    const blocked = curPct >= BLOCKED_PCT;
    const switchTo = (cx) => (s.target.token ? this.activate(cx, s.target.key) : this.reset(cx));
    return h_flex().gap(10).items_center().px(12).py(10).rounded(10).flex_none().border_1().border_color(blocked ? DANGER : WARN).bg(t.surface)
      .child(v_flex().flex_1().min_w(0).gap(2).text_size(12)
        .child(div().truncate().text_color(t.foreground).child(`지금 계정 ${s.current.label} · ${blocked ? "한도 다 씀" : `한도 ${Math.round(curPct)}% 사용`}`))
        .child(div().truncate().text_color(t.muted).child(`가장 여유 ${s.target.label} · ${Math.round(100 - tgtPct)}% 남음`)))
      .child(this.button("suggest", `${s.target.label} 쓰기`, { primary: true, enabled: !this.busy(), onClick: switchTo }));
  }

  row(e, activeKey, now) {
    const t = theme();
    const busy = this.busy();
    const active = e.key === activeKey, open = this.expanded === e.key, token = e.token;
    const pct = usedPct(e.usage), blocked = isBlocked(e.usage);
    const switching = this.action && ((this.action.kind === "activate" && this.action.id === e.key) || (this.action.kind === "reset" && !token));
    const onUse = (cx) => (token ? this.activate(cx, e.key) : this.reset(cx));
    const line = h_flex().gap(10).items_center()
      .child(v_flex().id(`name-${e.key}`).flex_1().min_w(0).gap(1).cursor_pointer()
        .on_click((_e, cx) => { this.expanded = open ? null : e.key; cx.notify(); })
        .child(h_flex().gap(4).items_center().min_w(0)
          .child(div().truncate().min_w(0).text_size(13).font_semibold().text_color(blocked ? t.dim : t.foreground).child(e.label))
          .child(div().flex_none().text_size(10).text_color(t.dim).child(open ? "▴" : "▾")))
        .child(div().truncate().text_size(10.5).text_color(t.dim).child(summaryText(e.usage, this.usageLoading, now))))
      .child(div().w(96).flex_none().h(6).rounded(3).bg(t.border)
        .when(pct !== null, (el) => el.child(div().h(6).rounded(3).w(`${pct}%`).bg(meterColor(pct, t)))))
      .child(div().w(36).flex_none().text_size(12).font_semibold().text_color(blocked ? t.dim : t.foreground).child(pct === null ? "—" : `${Math.round(pct)}%`))
      .child(h_flex().w(84).flex_none().justify_end().child(active
        ? div().text_size(11.5).font_semibold().text_color(t.accent).child("✓ 사용 중")
        : this.button(`use-${e.key}`, switching ? "바꾸는 중…" : token ? "쓰기" : "초기화", { enabled: !busy, onClick: onUse })));
    const editing = token && this.editing === token.id;
    const armed = token && this.armed === token.id;
    const expanded = () => v_flex().gap(10).pt(10).border_t_1().border_color(t.border)
      .child(h_flex().text_size(11).text_color(t.dim)
        .child(div().flex_1().child(token ? "토큰" : "계정")).child(div().text_color(t.muted).child(e.detail)))
      .when(Boolean(this.details(e.usage)), (el) => el.child(this.details(e.usage)))
      .when(Boolean(token), (el) => el.child(editing
        ? h_flex().gap(6).items_center()
          .child(Input.new(this.renameInput).flex_1().h(28).px(8).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground))
          .child(this.button(`save-${e.key}`, "저장", { primary: true, onClick: (cx) => this.saveRename(cx, token) }))
          .child(this.button(`cancel-${e.key}`, "취소", { onClick: (cx) => this.cancelEdit(cx) }))
        : h_flex().gap(6).justify_end()
          .child(this.button(`rename-${e.key}`, "이름 바꾸기", { enabled: !busy, onClick: (cx) => this.startRename(cx, token) }))
          .child(active
            ? div().px(6).h(28).flex().items_center().text_size(11).text_color(t.dim).child("사용 중이라 삭제 불가")
            : this.button(`del-${e.key}`, armed ? "한 번 더 누르면 삭제" : "삭제", { danger: armed, enabled: !busy, onClick: (cx) => this.remove(cx, token.id) }))));
    return v_flex().id(`acct-${e.key}`).gap(0).px(10).py(8).rounded(9).flex_none()
      .bg(active ? t.selected : open ? t.raised : t.popover)
      .child(line)
      .when(open, (el) => el.child(div().pt(10).child(expanded())));
  }

  addForm() {
    const t = theme();
    if (!this.adding) {
      return h_flex().id("add-open").h(38).flex_none().items_center().justify_center().rounded(10).border_1().border_dashed().border_color(t.input)
        .text_size(12.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.openAdd(cx)).child("+ 토큰 추가");
    }
    const pending = this.action?.kind === "add";
    const field = (label, input) => v_flex().gap(5)
      .child(div().text_size(11).text_color(t.muted).child(label))
      .child(Input.new(input).h(32).px(9).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground));
    const ready = this.labelInput.value().trim() && this.tokenInput.value().trim();
    return v_flex().gap(10).p(12).rounded(10).bg(t.surface).flex_none()
      .child(field("이름", this.labelInput))
      .child(field("OAuth 토큰", this.tokenInput))
      .child(div().text_size(11).text_color(t.dim).child("그 계정으로 로그인한 터미널에서 claude setup-token 을 실행하면 나옵니다. 저장 전에 실제로 되는 토큰인지 확인합니다."))
      .when(Boolean(this.addError), (el) => el.child(div().text_size(11.5).text_color(DANGER).child(this.addError)))
      .child(h_flex().gap(8).justify_end()
        .child(this.button("add-cancel", "취소", { enabled: !pending, onClick: (cx) => this.closeAdd(cx) }))
        .child(this.button("add-save", pending ? "확인 중…" : "저장", { primary: true, enabled: Boolean(ready) && !this.action, onClick: (cx) => this.add(cx) })));
  }

  body() {
    const t = theme(), o = this.overview, u = this.usage;
    if (this.cfgError) {
      return v_flex().gap(8).p(12).rounded(10).bg(t.surface)
        .child(div().text_size(12.5).text_color(WARN).child(`설정이 필요합니다 — ${this.cfgError}`))
        .child(div().text_size(11.5).text_color(t.muted).child(`${configPath()} 에 {"on": "<서버 기기 이름>", "command": ["<서버에서 돌릴 명령>", …]} 를 두거나, 플러그인의 install_claude_oauth.py --on … --command "…" 로 만드세요.`));
    }
    if (!o) {
      if (!this.loadError) return div().p(12).text_size(12.5).text_color(t.muted).child("서버에서 불러오는 중…");
      return v_flex().gap(10).p(12).items_start()
        .child(div().text_size(12.5).text_color(DANGER).child(`불러오지 못했습니다: ${this.loadError}`))
        .child(this.button("reload", "다시 시도", { onClick: (cx) => { this.loadError = null; cx.notify();
          cx.spawn(async (cx) => { await Promise.all([this.loadOverview(cx), this.loadUsage(cx, false)]); }); } }));
    }
    const entries = buildEntries(o, u);
    const activeKey = o.activeId ?? LOGIN_KEY;
    const suggestion = pickSwitchTarget(entries, activeKey);
    const now = u?.login.checkedAt || Date.now();  // 남은 시간은 사용량을 확인한 시각 기준(웹과 같음)
    return v_flex().flex_1().min_h(0).gap(10)
      .child(this.statusCard())
      .when(Boolean(suggestion), (el) => el.child(this.suggestionCard(suggestion)))
      .child(h_flex().items_center().flex_none()
        .child(div().flex_1().text_size(11.5).text_color(t.muted).child(`한도 · 여유 많은 순 ${entries.length}`))
        .child(div().id("refresh").h(22).px(7).rounded(6).flex().items_center().text_size(11).text_color(t.muted)
          .opacity(this.refreshing ? 0.5 : 1).when(!this.refreshing, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .on_click((_e, cx) => { if (!this.refreshing) cx.spawn(async (cx) => this.loadUsage(cx, true)); })
          .child(this.refreshing ? "다시 확인 중…" : `↻ ${checkedText(u?.login.checkedAt) || "다시 확인"}`)))
      .child(v_flex().flex_1().min_h(0).gap(2).overflow_y_scrollbar()
        .children([...entries.map((e) => this.row(e, activeKey, now)), div().h(6).flex_none(), this.addForm()]));
  }

  render() {
    const t = theme();
    return v_flex().id(MOD).track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().min_h(0).p(16).gap(12).rounded(8).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(h_flex().items_center().gap(8).flex_none()
        .child(svg(`mods/${MOD}/key.svg`).size(16).text_color(t.foreground))
        .child(div().flex_1().text_size(15).font_semibold().child("Claude 계정 전환"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_none().text_size(11.5).text_color(t.muted)
        .child("서버·로컬PC의 claude 가 쓰는 계정을 바꿉니다. 서버 보관함을 그대로 씁니다."))
      .child(this.body());
  }
}
