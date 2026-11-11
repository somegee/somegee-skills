"""herdr 앱: Ctrl+N 으로 지금 공간에 ccd(claude --dangerously-skip-permissions) 새 탭을 연다.

keys.json 은 tab.new 에 argv 를 못 넘기므로 작은 mod(ccd-key)가 키를 받아 연다.
  python install_ccd_key.py                          # 설치 (멱등)
  python install_ccd_key.py --ccd-folder "<경로>"    # 그 폴더에서 열기 ("" = 지정 해제 → 공간 폴더)
  python install_ccd_key.py --remove                 # 단축키·mod 제거
폴더를 안 주면 이미 설치된 값을 유지한다(정하는 순서는 ccd_folder.py). 다른 기기(원격) 공간에선 늘 그 공간 폴더.

주의: 단축키가 ccd-key.new 를 가리키면 앱이 레이아웃에 mod 칸을 스스로 넣는다 → 기다렸다가 없을 때만 넣고,
여러 개면 하나만 남긴다(두 개면 Ctrl+N 한 번에 탭이 두 개 열림).
Ctrl+N 은 global 묶음에 걸어 터미널 안에서도 앱이 먼저 받는다 → 프로그램의 Ctrl+N(Claude 입력 기록 아래로 등)은 못 쓴다.
"""
import io
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME, LAYOUTS, SHIPPED, children_lists, ensure_own_layout, find_block, load, save  # noqa: E402
import ccd_folder  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MOD = "ccd-key"
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", MOD)
MOD_DIR = os.path.join(APP_HOME, "mods", MOD)
KEYS = os.path.join(APP_HOME, "keys.json")
KEY = "ctrl-n"
ACTION = MOD + ".new"


def mod_blocks(layout):
    found = []
    for lst in children_lists(layout):
        for child in lst:
            if isinstance(child, dict) and (child.get("content") or {}).get("mod") == MOD:
                found.append((lst, child))
    return found


def set_key(value):
    with io.open(KEYS, encoding="utf-8") as f:
        keys = json.load(f)
    glob = keys.setdefault("global", {})
    if value is None:
        if glob.get(KEY) != ACTION:
            return
        glob.pop(KEY)
    else:
        if glob.get(KEY) == value:
            return
        if glob.get(KEY) not in (None, value):
            sys.exit("Ctrl+N 이 이미 다른 동작(%s)에 걸려 있음 — keys.json 을 보고 정한 뒤 다시 실행" % glob.get(KEY))
        glob[KEY] = value
    backup = KEYS + ".bak-ccdkey"
    if not os.path.exists(backup):
        shutil.copy2(KEYS, backup)
    with io.open(KEYS, "w", encoding="utf-8") as f:
        f.write(json.dumps(keys, ensure_ascii=False, indent=2))


def copy_mod(folder):
    """mod 파일을 복사하되 main.js 의 FOLDER 줄은 정한 폴더로 채운다(먼저 정해야 설치본 값을 읽을 수 있음)."""
    os.makedirs(MOD_DIR, exist_ok=True)
    shutil.copy2(os.path.join(SRC, "mod.json"), os.path.join(MOD_DIR, "mod.json"))
    with io.open(os.path.join(SRC, "main.js"), encoding="utf-8", newline="") as f:
        src = f.read()
    with io.open(os.path.join(MOD_DIR, "main.js"), "w", encoding="utf-8", newline="") as f:
        f.write(ccd_folder.set_in_source(src, "FOLDER", folder))


def install(folder_arg=None):
    folder = ccd_folder.resolve(folder_arg)
    copy_mod(folder)
    target = ensure_own_layout()
    set_key(ACTION)
    for _ in range(12):  # 앱이 스스로 칸을 넣는지 최대 6초
        if mod_blocks(load(target)):
            break
        time.sleep(0.5)
    layout = load(target)
    blocks = mod_blocks(layout)
    if not blocks:
        lst, i = find_block(layout, "status")
        if lst is None:
            sys.exit("layouts/%s.json 에서 'status' 블록을 못 찾음 — 손으로 넣어야 함" % target)
        lst.insert(i + 1, {"id": MOD, "type": "block", "size": {"px": 0}, "content": {"mod": MOD}})
        save(target, layout)
        print("레이아웃에 칸 추가:", target)
    elif len(blocks) > 1:
        for lst, child in blocks[1:]:
            lst.remove(child)
        save(target, layout)
        print("중복 칸 정리:", len(blocks) - 1, "개 제거")
    print("설치 완료: Ctrl+N = ccd 새 탭 / 레이아웃:", target, "/ 폴더:", ccd_folder.describe(folder))


def remove():
    set_key(None)
    for fname in os.listdir(LAYOUTS):
        name, ext = os.path.splitext(fname)
        if ext != ".json" or name in SHIPPED:
            continue
        layout = load(name)
        blocks = mod_blocks(layout)
        for lst, child in blocks:
            lst.remove(child)
        if blocks:
            save(name, layout)
            print("레이아웃에서 뺌:", name)
    shutil.rmtree(MOD_DIR, ignore_errors=True)
    print("제거 완료: Ctrl+N")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install(ccd_folder.parse_arg(sys.argv[1:]))
