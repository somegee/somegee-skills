"""herdr 앱에 title-sync mod를 설치한다 (/rename → 탭 이름 따라가기).

앱이 도는 PC에서만 실행한다. 여러 번 실행해도 같은 결과(멱등).
  python install_title_sync.py            # 설치
  python install_title_sync.py --remove   # 제거

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

APP_HOME = os.environ.get("HERDR_APP_HOME") or os.path.join(os.path.expanduser("~"), ".config", "herdr-app")
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "title-sync")
MOD_DIR = os.path.join(APP_HOME, "mods", "title-sync")
LAYOUTS = os.path.join(APP_HOME, "layouts")
SHIPPED = {"main", "terminals", "win98"}
BLOCK = {"id": "title-sync", "type": "block", "size": {"px": 0}, "content": {"mod": "title-sync"}}


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
    with io.open(layout_path(name), "w", encoding="utf-8") as f:
        f.write(json.dumps(layout, ensure_ascii=False, indent=2))


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


def drop_extra_blocks(target, layout):
    """앱이 mod 파일을 다시 받으면 title-sync 칸을 스스로 하나 더 넣기도 한다(2026-11-11 실측,
    맨 바깥에 임의 id 로) → 첫 칸만 남긴다. 두 칸이면 탭 이름을 두 번 고친다."""
    found = [(lst, c) for lst in children_lists(layout) for c in lst
             if isinstance(c, dict) and (c.get("content") or {}).get("mod") == "title-sync"]
    for lst, child in found[1:]:
        lst.remove(child)
    if len(found) > 1:
        save(target, layout)
        print("중복 칸 정리:", len(found) - 1, "개 제거")


def install():
    os.makedirs(MOD_DIR, exist_ok=True)
    for name in ("main.js", "mod.json"):
        shutil.copy2(os.path.join(SRC, name), os.path.join(MOD_DIR, name))
    target = ensure_own_layout()
    layout = load(target)
    if find_block(layout, "title-sync")[0] is not None:
        drop_extra_blocks(target, layout)
        print("이미 레이아웃에 있음 — mod 파일만 갱신:", target)
        return
    lst, i = find_block(layout, "status")  # 맨 아래 상태줄 옆에 높이 0 칸
    if lst is None:
        sys.exit("layouts/%s.json 에서 'status' 블록을 못 찾음 — 손으로 넣어야 함" % target)
    lst.insert(i + 1, dict(BLOCK))
    save(target, layout)
    print("설치 완료:", MOD_DIR, "/ 레이아웃:", target)


def remove():
    for fname in os.listdir(LAYOUTS):
        name, ext = os.path.splitext(fname)
        if ext != ".json" or name in SHIPPED:
            continue
        layout = load(name)
        lst, i = find_block(layout, "title-sync")
        if lst is not None:
            del lst[i]
            save(name, layout)
            print("레이아웃에서 뺌:", name)
    shutil.rmtree(MOD_DIR, ignore_errors=True)
    print("제거 완료 (복제한 레이아웃은 남겨 둠 — 기본으로 돌아가려면 ctrl-shift-l 로 main 선택)")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install()
