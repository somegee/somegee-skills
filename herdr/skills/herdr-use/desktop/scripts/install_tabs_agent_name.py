"""herdr 앱 상단 탭 바: 아무도 이름 안 붙인 에이전트 탭을 번호(1, 2…) 대신 프로그램 이름(「Claude Code」 등)으로 보인다.

탭 이름 자체는 바꾸지 않고(표시만), 이름 붙인 탭·일반 셸 탭은 그대로 둔다.
/rename 하면 title-sync 가 탭 이름을 바꾸므로 그때부터는 그 이름이 보인다.

기본 tabs mod 는 읽기 전용이라 my-tabs 로 복제해 고치고, 내 레이아웃이 my-tabs 를 쓰게 바꾼다.
  python install_tabs_agent_name.py            # 적용 (멱등)
  python install_tabs_agent_name.py --remove   # 기본 tabs 로 되돌림 (my-tabs 폴더는 남김)
설치할 때마다 원본 mods/tabs/main.js 에서 다시 고쳐 덮어쓴다(patchlib).
my-new-menu(install_ccd_button.py 가 만듦)가 있으면 + 버튼이 기본 new-menu 대신 그걸 열게 한다 —
없는데 가리키면 + 버튼이 아무것도 안 열므로 있을 때만.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import ensure_own_layout  # noqa: E402
from install_agents_name_only import point_layout  # noqa: E402
from patchlib import apply_patches, mod_js, rebuild  # noqa: E402
import done_hold  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "tabs"
CLONE = "my-tabs"
NL = "\n"
PATCHES = [
    # 이름 없는 에이전트 탭은 번호 대신 프로그램 이름
    ('const name = /^tb\\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;',
     'const name = /^tb\\d+$/.test(c.name) || (!c.named && program?.agent) ? program?.name ?? "Terminal" : c.name;'),
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
]
NEW_MENU = "my-new-menu"
# + 버튼 → my-new-menu (ccd 를 설치 때 정한 폴더에서 여는 + 메뉴)
NEW_MENU_PATCH = ('openOverlay({ mod: "new-menu", kind: "popup"', 'openOverlay({ mod: "%s", kind: "popup"' % NEW_MENU)


def patches() -> list:
    return PATCHES + ([NEW_MENU_PATCH] if os.path.exists(mod_js(NEW_MENU)) else [])


def build() -> bool:
    return rebuild(BASE, CLONE, lambda src: done_hold.apply(apply_patches(src, patches(), BASE), BASE))


def refresh() -> None:
    """my-new-menu 를 만들거나 지운 뒤 부른다 — my-tabs 가 이미 있으면 + 버튼 연결만 다시 맞춘다(레이아웃은 안 건드림)."""
    if os.path.exists(mod_js(CLONE)) and build():
        print("my-tabs 다시 만듦: + 버튼 →", NEW_MENU if os.path.exists(mod_js(NEW_MENU)) else "new-menu(기본)")


def install() -> None:
    target = ensure_own_layout()
    changed = build()
    n = point_layout(target, BASE, CLONE)
    menu = NEW_MENU if os.path.exists(mod_js(NEW_MENU)) else "new-menu(기본)"
    print("적용 완료: 레이아웃", target, "/ tabs → my-tabs 연결", n, "곳", "(코드 고침)" if changed else "(코드 변경 없음)", "/ + 버튼 →", menu)


def remove() -> None:
    target = ensure_own_layout()
    print("되돌림:", point_layout(target, CLONE, BASE), "곳 (레이아웃 " + target + ")")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install()
