"""herdr 앱 상단 탭 바: 아무도 이름 안 붙인 에이전트 탭을 번호(1, 2…) 대신 프로그램 이름(「Claude Code」 등)으로 보인다.

탭 이름 자체는 바꾸지 않고(표시만), 이름 붙인 탭·일반 셸 탭은 그대로 둔다.
/rename 하면 title-sync 가 탭 이름을 바꾸므로 그때부터는 그 이름이 보인다.

기본 tabs mod 는 읽기 전용이라 my-tabs 로 복제해 고치고, 내 레이아웃이 my-tabs 를 쓰게 바꾼다.
  python install_tabs_agent_name.py            # 낡음·없음이면 적용, 최신이면 '변경 없음'
  python install_tabs_agent_name.py --status   # 상태 한 줄(--json) / --dry-run 미리보기
  python install_tabs_agent_name.py --remove   # 기본 tabs 로 되돌림 (my-tabs 폴더는 남김)
설치할 때마다 원본 mods/tabs/main.js 에서 다시 고쳐 덮어쓴다(patchlib).
resume-all(install_resume_all.py 가 깖)이 있으면 우상단 Files 왼쪽에 Resume 버튼을 넣는다 — 없는데 가리키면 버튼이 아무것도 안 하므로 있을 때만.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import ensure_own_layout  # noqa: E402
from install_agents_name_only import clone_plan, point_layout  # noqa: E402
from patchlib import apply_patches, ensure_imports, mod_js, rebuild, register  # noqa: E402
import addons  # noqa: E402
from featurelib import HAND, Plan, evaluate, run_cli, safe_plan  # noqa: E402
import done_hold  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "tabs"
CLONE = FEATURE = "my-tabs"
NL = "\n"
PATCHES = [
    # 이름 없는 에이전트 탭은 번호 대신 프로그램 이름.
    # 앱 0.1.16 부터 원본 label() 이 이미 이름 없는 탭에 프로그램 이름(에이전트면 그 실시간 제목)을 보인다 → 그대로 둔다
    [('const name = /^tb\\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;',
      'const name = /^tb\\d+$/.test(c.name) || (!c.named && program?.agent) ? program?.name ?? "Terminal" : c.name;'),
     ("const name = label(c, lead);", "const name = label(c, lead);")],
    # 드래그 중 끼워질 자리에 점선 — 누른 채 다른 탭 위에 올라가면 그 탭 기억
    ("      return h_flex().id(`tab-${c.id}`).h(29)",
     "      const tab = h_flex().id(`tab-${c.id}`).h(29)"),
    ("        .hover(s => s.bg(t.hover))" + NL + '        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i;',
     "        .hover(s => s.bg(t.hover))" + NL
     + "        .on_hover((on, cx) => { if (this.pressed === null) return; if (on) this.over = i; else if (this.over === i) this.over = null; cx.notify(); })" + NL
     + '        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i;'),
    ("          const from = this.pressed; this.pressed = null;",
     "          const from = this.pressed; this.pressed = null; this.over = null;"),
    # tab.move 는 오른쪽으로 끌면 대상 뒤, 왼쪽으로 끌면 대상 앞에 놓인다 → 그쪽에 점선
    (".child(svg(\"mods/pane/close.svg\").size(12))));" + NL + "    };",
     ".child(svg(\"mods/pane/close.svg\").size(12))));" + NL
     + "      const from = this.pressed, target = this.over === i && from !== null && from !== i;" + NL
     + "      const mark = () => div().w(0).h(24).flex_none().border_l(2).border_dashed().border_color(t.accent);" + NL
     + "      return h_flex().gap(3).items_center().flex_none()" + NL
     + "        .when(target && from > i, el => el.child(mark())).child(tab).when(target && from < i, el => el.child(mark()));" + NL
     + "    };"),
    ('.on_mouse_up("left", () => { this.pressed = null; })',
     '.on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })'),
    # 탭 x 는 두 번 눌러야 닫힌다: 첫 번째엔 빨간 바탕(준비), CLOSE_ARM_MS 안에 한 번 더 누르면 닫음, 지나면 원래대로
    ("export default class Tabs extends View {",
     "// [herdr-use close-confirm] 탭 x 두 번 눌러 닫기" + NL
     + "const CLOSE_ARM_MS = 3000;" + NL
     + "const CLOSE_TICK_MS = 250;" + NL
     + 'const CLOSE_ARMED_BG = "#e5484d";' + NL
     + 'const CLOSE_ARMED_FG = "#ffffff";' + NL + NL
     + "export default class Tabs extends View {"),
    ("  init() {" + NL + "    this.pressed = null;",
     "  init(_props, cx) {" + NL + "    this.pressed = null;" + NL
     + "    this.closeArm = null; this.closeArmAt = 0; // 빨갛게 준비된 x 의 탭 id" + NL
     + "    cx.timer.every(CLOSE_TICK_MS, (cx) => { if (this.closeArm !== null && Date.now() - this.closeArmAt > CLOSE_ARM_MS) { this.closeArm = null; cx.notify(); } });"),
    ('div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })',
     'div().id(`close-${c.id}`).p(2).rounded(4).text_color(this.closeArm === c.id ? CLOSE_ARMED_FG : t.dim)'
     '.when(this.closeArm === c.id, el => el.bg(CLOSE_ARMED_BG))'
     '.on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation();'
     ' if (this.closeArm === c.id && Date.now() - this.closeArmAt <= CLOSE_ARM_MS) { this.closeArm = null; run("tab.close", { id: c.id }); }'
     ' else { this.closeArm = c.id; this.closeArmAt = Date.now(); } cx.notify(); })'),
]

RESUME_MOD = "resume-all"
# 우상단 Files/Changes 왼쪽 Resume 버튼 → resume-all 팝업. 후보 규칙은 assets/resume-all/main.js 의
# resumableTerminals() 와 같아야 한다(mod 끼리 import 못 함 — 한쪽만 고치면 버튼 숫자와 팝업 목록이 어긋남).
RESUME_JS = NL.join([
    "// [herdr-use resume-all] 재부팅 뒤 셸로만 남은 Claude 세션(세션 이름표 있음) 수. mods/resume-all 의 resumableTerminals() 와 같은 규칙.",
    "const RESUME_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;",
    "const RESUME_PROJECT_RE = /^[A-Za-z0-9_-]{1,200}$/;",
    "function resumableCount() {",
    "  const shown = new Set(panes().filter((p) => p.terminal).map((p) => p.terminal));",
    '  return terminals().filter((t) => t.state === "live" && !String(t.address).includes("/") && !t.status && !t.program?.agent',
    '    && RESUME_SESSION_RE.test(t.labels?.["claude.session"] ?? "") && RESUME_PROJECT_RE.test(t.labels?.["claude.project"] ?? "")',
    "    && shown.has(t.address)).length;",
    "}",
    "",
])
RESUME_RENDER = NL.join([
    "    // [herdr-use resume-all] Files/Changes 옆: 이어할 세션이 있으면 강조 + 개수, 누르면 일괄 이어하기 팝업",
    "    const resumeCount = resumableCount();",
    '    const resumeButton = () => h_flex().id("resume-all").h(26).px(8).gap(5).flex_none().items_center().rounded(6)',
    "      .text_size(12).bg(resumeCount ? t.selected : t.chrome).text_color(resumeCount ? t.accent : t.muted)",
    '      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)',
    '      .on_click(() => openOverlay({ mod: "%s", kind: "dialog", width: 600, height: Math.min(620, 200 + Math.max(1, resumeCount) * 56) }))' % RESUME_MOD,
    '      .child(svg("mods/%s/resume.svg").size(14)).child(resumeCount ? `Resume ${resumeCount}` : "Resume");' % RESUME_MOD,
    "",
])
FILES_BUTTON = '      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))'
# close-confirm 패치 뒤에 건다(같은 class 줄을 기준으로 그 상수 아래에 들어감)
RESUME_PATCHES = [
    ("export default class Tabs extends View {", RESUME_JS + "export default class Tabs extends View {"),
    ("    return h_flex().size_full().min_w(0).px(10)", RESUME_RENDER + "    return h_flex().size_full().min_w(0).px(10)"),
    (FILES_BUTTON, "      .child(resumeButton())" + NL + FILES_BUTTON),
]


def has_resume() -> bool:
    # rename_self 는 "mods/tabs/" 만 바꾸므로 "mods/resume-all/…" 경로는 그대로 남는다
    return os.path.exists(mod_js(RESUME_MOD))


def patches() -> list:
    return PATCHES + (RESUME_PATCHES if has_resume() else [])


def patched(src: str) -> str:
    src = apply_patches(src, patches(), BASE)
    if has_resume():
        src = ensure_imports(src, ("terminals",))
    return done_hold.apply(src, BASE)


def wiring() -> str:
    extra = addons.summary(CLONE)
    return "Resume 버튼 %s%s" % ("있음" if has_resume() else "없음(resume-all 미설치)", " / " + extra if extra else "")


register(BASE, CLONE, patched)


def build() -> bool:
    return rebuild(BASE, CLONE, patched)


def plan() -> Plan:
    return clone_plan(FEATURE, BASE, CLONE, patched)


def refresh() -> None:
    """resume-all 을 만들거나 지운 뒤 부른다 — my-tabs 가 이미 있으면 Resume 버튼만 다시 맞춘다(레이아웃은 안 건드림)."""
    if not os.path.exists(mod_js(CLONE)):
        return
    st = evaluate(safe_plan(FEATURE, plan))
    if st.state == HAND:  # resume-all 적용이 손으로 고친 my-tabs 를 몰래 덮지 않게
        print("!! my-tabs 는 손으로 고친 흔적이 있어 Resume 버튼을 안 맞춤 — 확인 뒤 install_tabs_agent_name.py --force")
        return
    if build():
        print("my-tabs 다시 만듦:", wiring())


def install() -> None:
    target = ensure_own_layout()
    changed = build()
    n = point_layout(target, BASE, CLONE)
    print("적용 완료: 레이아웃", target, "/ tabs → my-tabs 연결", n, "곳", "(코드 고침)" if changed else "(코드 변경 없음)", "/", wiring())


def remove() -> None:
    target = ensure_own_layout()
    print("되돌림:", point_layout(target, CLONE, BASE), "곳 (레이아웃 " + target + ")")


if __name__ == "__main__":
    run_cli(FEATURE, plan, install, remove)
