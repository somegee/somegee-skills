"""herdr 앱(Windows)에 claude-notes mod 를 설치한다 — 보고 있는 Claude 세션의 notes 를 오른쪽 패널에서 본다(보기만).

notes 플러그인(0.22.0~)은 herdr 터미널 안에서 켜지면 TUI 옆 창을 저절로 열지 않고(설정 hideInHerdr),
상태 파일 ~/.claude/notes-data/live/<세션>.json 에 노트 파일 위치(file)를 남긴다. 이 mod 는
보고 있는 터미널 → 이름표 claude.session(이 플러그인의 훅) → 그 노트 파일을 읽어 그린다. 원격 기기 탭은 그 기기에서 읽는다.
자리: 오른쪽 패널(Files·Changes 와 같은 stack 'panel-body')의 한 칸. 펴고 접는 상단 `Notes` 버튼은 my-tabs 안에 있다
→ 설치·제거 뒤 my-tabs 를 다시 맞춘다(refresh).

  python install_claude_notes.py            # 낡음·없음이면 설치, 최신이면 '변경 없음'
  python install_claude_notes.py --status   # 상태 한 줄(--json) / --dry-run 미리보기
  python install_claude_notes.py --remove   # mod 폴더와 레이아웃 칸을 지우고 my-tabs 에서 Notes 버튼을 뺀다
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import (  # noqa: E402
    LAYOUTS, SHIPPED, asset_wants, copy_assets, ensure_own_layout, find_block, layout_path, load,
    mod_blocks, own_layout_check, save, target_layout,
)
from apphome import APP_HOME  # noqa: E402
from featurelib import Check, Plan, run_cli  # noqa: E402
import install_tabs_agent_name  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEATURE = MOD = install_tabs_agent_name.NOTES_MOD
FILES = ("main.js", "mod.json", "notes.svg")
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", MOD)
MOD_DIR = os.path.join(APP_HOME, "mods", MOD)
STACK = "panel-body"  # 기본 레이아웃의 오른쪽 패널(Files·Changes) stack


def stack_children(layout):
    lst, i = find_block(layout, STACK)
    if lst is None:
        return None
    children = lst[i].get("children")
    return children if isinstance(children, list) else None


def layout_ok(layout) -> bool:
    """패널 stack 안에 이 mod 칸이 딱 1개이고, 다른 곳엔 없는지."""
    children = stack_children(layout)
    if children is None:
        return False
    inside = [c for c in children if isinstance(c, dict) and (c.get("content") or {}).get("mod") == MOD]
    return len(inside) == 1 and len(mod_blocks(layout, MOD)) == 1


def placed(layout):
    """layout 을 고쳐 패널 stack 맨 앞에 이 mod 칸 하나만 남긴다. 고쳤으면 True. stack 이 없으면 SystemExit."""
    children = stack_children(layout)
    if children is None:
        sys.exit("레이아웃에 오른쪽 패널(stack '%s')이 없음 — 기본 레이아웃을 복제한 것이 아니면 손으로 칸을 넣어야 함" % STACK)
    if layout_ok(layout):
        return False
    for lst, child in mod_blocks(layout, MOD):
        lst.remove(child)
    children.insert(0, {"id": MOD, "type": "block", "content": {"mod": MOD}})
    return True


def layout_check(target):
    if not os.path.exists(layout_path(target)):
        return Check("레이아웃 %s 없음" % target, False, "레이아웃 %s 만들고 오른쪽 패널에 notes 칸 넣기" % target)
    return Check("레이아웃 %s 오른쪽 패널에 notes 칸 없음(또는 중복)" % target, layout_ok(load(target)),
                 "레이아웃 %s: 오른쪽 패널(%s)에 notes 칸 하나" % (target, STACK))


def plan():
    target = target_layout()
    return Plan(FEATURE, files=asset_wants(SRC, MOD_DIR, FILES),
                checks=(own_layout_check(), layout_check(target)),
                present=os.path.exists(os.path.join(MOD_DIR, "main.js")))


def install():
    changed = copy_assets(SRC, MOD_DIR, FILES)
    print("mod 파일:", ", ".join(changed) + " 바꿈" if changed else "그대로")
    target = ensure_own_layout()
    layout = load(target)
    if placed(layout):
        save(target, layout)
        print("레이아웃 %s: 오른쪽 패널에 notes 칸 넣음" % target)
    install_tabs_agent_name.refresh()  # my-tabs 가 있으면 Notes 버튼을 넣는다(없으면 my-tabs 설치 때 들어감)


def remove():
    if os.path.exists(MOD_DIR):
        shutil.rmtree(MOD_DIR, ignore_errors=True)
        print("지움:" if not os.path.exists(MOD_DIR) else "!! 못 지움(앱이 잡고 있는 듯, 손으로 지우세요):", MOD_DIR)
    else:
        print("없음 —", MOD_DIR)
    for fname in sorted(os.listdir(LAYOUTS)) if os.path.isdir(LAYOUTS) else []:
        name, ext = os.path.splitext(fname)
        if ext != ".json" or name in SHIPPED:
            continue
        layout = load(name)
        blocks = mod_blocks(layout, MOD)
        for lst, child in blocks:
            lst.remove(child)
        if blocks:
            save(name, layout)
            print("레이아웃 %s: notes 칸 %d개 뺌" % (name, len(blocks)))
    install_tabs_agent_name.refresh()  # 없는 칸을 펴는 버튼이 남지 않게


if __name__ == "__main__":
    run_cli(FEATURE, plan, install, remove)
