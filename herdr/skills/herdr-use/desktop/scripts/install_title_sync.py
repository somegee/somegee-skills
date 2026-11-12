"""herdr 앱에 title-sync mod를 설치한다 (/rename → 탭 이름 따라가기).

앱이 도는 PC에서만 실행한다. 여러 번 실행해도 같은 결과(멱등).
  python install_title_sync.py            # 낡음·없음이면 설치, 최신이면 '변경 없음'
  python install_title_sync.py --status   # 상태 한 줄(--json) / --dry-run 미리보기 / --remove 제거

herdr 기본 레이아웃(main·terminals·win98)은 읽기 전용이다. 앱을 켤 때마다 원본으로
덮어쓰고, 고친 파일은 <name>-edited 로 치워 버린다. 그래서 기본 레이아웃을 쓰는 중이면
먼저 `layout.clone` 으로 내 레이아웃(my-<name>)을 만들어 전환한 뒤 그 복제본에 칸을 넣는다.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apphome import APP_HOME  # noqa: E402
from featurelib import Check, Plan, Want, read_bytes, run_cli, write_if_changed, write_json_if_changed  # noqa: E402

FEATURE = "title-sync"
MOD = "title-sync"
FILES = ("main.js", "mod.json")
APP_WAIT_TRIES = 12  # 단축키를 건 뒤 앱이 mod 칸을 스스로 넣는지 기다리는 횟수
APP_WAIT_SECONDS = 0.5
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "title-sync")
MOD_DIR = os.path.join(APP_HOME, "mods", "title-sync")
LAYOUTS = os.path.join(APP_HOME, "layouts")
SHIPPED = {"main", "terminals", "win98"}


def app_exe():
    found = shutil.which("herdr-app")
    if found:
        return found
    local = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "herdr-app", "herdr-app.exe")
    if os.path.exists(local):
        return local
    sys.exit("herdr-app 실행 파일을 못 찾음 — 앱 설치·실행 여부 확인")


def shown_layout():
    try:
        with io.open(os.path.join(APP_HOME, "shared.json"), encoding="utf-8") as f:
            return json.load(f).get("layout") or "main"
    except (OSError, ValueError):
        return "main"


def layout_path(name):
    return os.path.join(LAYOUTS, name + ".json")


def children_lists(node):
    """레이아웃 트리에서 블록 목록(list)들을 모두 돌려준다."""
    if isinstance(node, dict):
        for value in node.values():
            if isinstance(value, list) and any(isinstance(c, dict) and "id" in c for c in value):
                yield value
            yield from children_lists(value)
    elif isinstance(node, list):
        for item in node:
            yield from children_lists(item)


def find_block(layout, block_id):
    for lst in children_lists(layout):
        for i, child in enumerate(lst):
            if isinstance(child, dict) and child.get("id") == block_id:
                return lst, i
    return None, None


def load(name):
    with io.open(layout_path(name), encoding="utf-8") as f:
        return json.load(f)


def save(name, layout):
    """내용이 같으면 안 쓴다(앱이 레이아웃을 다시 읽지 않게)."""
    return write_json_if_changed(layout_path(name), layout)


def target_layout():
    """적용하면 얹힐 레이아웃 이름 — 앱에 아무것도 안 시키고 계산만(상태 확인용)."""
    name = shown_layout()
    return name if name not in SHIPPED else "my-" + name


def mod_blocks(layout, mod):
    """content.mod == mod 인 칸들을 (목록, 칸) 으로 돌려준다(id 는 앱이 무작위로 붙이기도 함)."""
    return [(lst, c) for lst in children_lists(layout) for c in lst
            if isinstance(c, dict) and (c.get("content") or {}).get("mod") == mod]


def own_layout_check():
    shown = shown_layout()
    return Check("기본 레이아웃(%s) 사용 중" % shown, shown not in SHIPPED,
                 "기본 레이아웃 %s → my-%s 로 복제·전환(앱에 시킴)" % (shown, shown))


def block_check(target, mod):
    """레이아웃에 mod 칸이 딱 1개인지. 0개면 mod 가 안 돌고, 2개면 두 번 돈다."""
    if not os.path.exists(layout_path(target)):
        return Check("레이아웃 %s 없음" % target, False, "레이아웃 %s 만들고 %s 칸 넣기" % (target, mod))
    n = len(mod_blocks(load(target), mod))
    return Check("레이아웃 %s 의 %s 칸 %d개" % (target, mod, n), n == 1,
                 "레이아웃 %s: %s 칸 %d개 → 1개" % (target, mod, n))


def ensure_one_block(target, mod, wait_for_app=False):
    """레이아웃에 mod 칸을 딱 1개로 맞춘다. wait_for_app: 단축키가 mod 를 가리키면 앱이 칸을 스스로 넣으므로
    잠깐 기다렸다가 없을 때만 넣는다(손으로 또 넣으면 두 번 돈다). 이미 1개면 파일을 안 건드린다."""
    for _ in range(APP_WAIT_TRIES if wait_for_app else 0):
        if mod_blocks(load(target), mod):
            break
        time.sleep(APP_WAIT_SECONDS)
    layout = load(target)
    blocks = mod_blocks(layout, mod)
    if len(blocks) == 1:
        return
    if not blocks:
        lst, i = find_block(layout, "status")  # 맨 아래 상태줄 옆에 높이 0 칸
        if lst is None:
            sys.exit("layouts/%s.json 에서 'status' 블록을 못 찾음 — 손으로 넣어야 함" % target)
        lst.insert(i + 1, {"id": mod, "type": "block", "size": {"px": 0}, "content": {"mod": mod}})
        save(target, layout)
        print("레이아웃에 %s 칸 추가: %s" % (mod, target))
        return
    for lst, child in blocks[1:]:
        lst.remove(child)
    save(target, layout)
    print("%s 중복 칸 정리: %d개 제거" % (mod, len(blocks) - 1))


def copy_assets(src_dir, mod_dir, names):
    """assets 의 mod 파일을 설치본으로 — 내용이 같은 파일은 안 쓴다. 바뀐 파일 이름 목록을 돌려준다."""
    changed = []
    for name in names:
        data = read_bytes(os.path.join(src_dir, name))
        if data is None:
            sys.exit("플러그인 assets 에 파일이 없음: " + os.path.join(src_dir, name))
        if write_if_changed(os.path.join(mod_dir, name), data):
            changed.append(name)
    return changed


def asset_wants(src_dir, mod_dir, names):
    wants = []
    for name in names:
        data = read_bytes(os.path.join(src_dir, name))
        if data is None:
            sys.exit("플러그인 assets 에 파일이 없음: " + os.path.join(src_dir, name))
        wants.append(Want(os.path.join(mod_dir, name), data))
    return tuple(wants)


def ensure_own_layout():
    """보이는 레이아웃이 기본 레이아웃이면 my-<name> 으로 복제해 전환하고 그 이름을 돌려준다."""
    name = shown_layout()
    if name not in SHIPPED:
        return name
    clone = "my-" + name
    if os.path.exists(layout_path(clone)):
        subprocess.run([app_exe(), "do", "layout.switch", json.dumps({"name": clone})], check=True)
        print("기존 복제본으로 전환:", clone)
    else:
        subprocess.run([app_exe(), "do", "layout.clone", json.dumps({"name": name, "as": clone})], check=True)
        print("기본 레이아웃은 읽기 전용이라 복제함:", name, "→", clone)
    for _ in range(20):  # 복제 파일이 생길 때까지
        if os.path.exists(layout_path(clone)):
            break
        time.sleep(0.25)
    return clone


def plan():
    target = target_layout()
    return Plan(FEATURE, files=asset_wants(SRC, MOD_DIR, FILES),
                checks=(own_layout_check(), block_check(target, MOD)),
                present=os.path.exists(os.path.join(MOD_DIR, "main.js")))


def install():
    changed = copy_assets(SRC, MOD_DIR, FILES)
    print("mod 파일:", ", ".join(changed) + " 바꿈" if changed else "그대로")
    target = ensure_own_layout()
    # 앱이 mod 파일을 다시 받으면 칸을 스스로 하나 더 넣기도 한다(2026-11-11 실측, 맨 바깥에 임의 id 로) → 1개로
    ensure_one_block(target, MOD)
    print("레이아웃:", target)


def remove():
    for fname in os.listdir(LAYOUTS):
        name, ext = os.path.splitext(fname)
        if ext != ".json" or name in SHIPPED:
            continue
        layout = load(name)
        blocks = mod_blocks(layout, MOD)
        for lst, child in blocks:
            lst.remove(child)
        if blocks:
            save(name, layout)
            print("레이아웃에서 뺌:", name)
    shutil.rmtree(MOD_DIR, ignore_errors=True)
    print("제거 완료 (복제한 레이아웃은 남겨 둠 — 기본으로 돌아가려면 ctrl-shift-l 로 main 선택)")


if __name__ == "__main__":
    run_cli(FEATURE, plan, install, remove)
