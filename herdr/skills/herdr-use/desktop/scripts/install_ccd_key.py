"""herdr 앱: Ctrl+N 으로 지금 공간에 ccd(claude --dangerously-skip-permissions) 새 탭을 연다.

keys.json 은 tab.new 에 argv 를 못 넘기므로 작은 mod(ccd-key)가 키를 받아 연다.
  python install_ccd_key.py                          # 낡음·없음이면 설치, 최신이면 '변경 없음'
  python install_ccd_key.py --status                 # 상태 한 줄(--json) / --dry-run 미리보기
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import (  # noqa: E402
    APP_HOME, LAYOUTS, SHIPPED, block_check, ensure_one_block, ensure_own_layout, load, mod_blocks, save, target_layout,
)
from featurelib import KEYS, Plan, Want, keys_check, read_bytes, run_cli, write_if_changed, write_json_if_changed  # noqa: E402
import ccd_folder  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEATURE = MOD = "ccd-key"
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", MOD)
MOD_DIR = os.path.join(APP_HOME, "mods", MOD)
KEY = "ctrl-n"
ACTION = MOD + ".new"


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
    write_json_if_changed(KEYS, keys)
    print("keys.json: Ctrl+N =", value)


def wants(folder):
    """설치본이 돼야 할 내용 — main.js 의 FOLDER 줄은 정한 폴더로 채운다."""
    main = read_bytes(os.path.join(SRC, "main.js"))
    meta = read_bytes(os.path.join(SRC, "mod.json"))
    if main is None or meta is None:
        sys.exit("플러그인 assets 에 ccd-key 파일이 없음: " + SRC)
    filled = ccd_folder.set_in_source(main.decode("utf-8"), "FOLDER", folder).encode("utf-8")
    return (Want(os.path.join(MOD_DIR, "main.js"), filled), Want(os.path.join(MOD_DIR, "mod.json"), meta))


def plan(folder_arg=None):
    target = target_layout()
    return Plan(FEATURE, files=wants(ccd_folder.resolve(folder_arg, quiet=True)),
                checks=(keys_check("global", KEY, ACTION, "Ctrl+N"), block_check(target, MOD)),
                present=os.path.exists(os.path.join(MOD_DIR, "main.js")))


def install(folder_arg=None):
    folder = ccd_folder.resolve(folder_arg)
    changed = [os.path.basename(w.path) for w in wants(folder) if write_if_changed(w.path, w.content)]
    print("mod 파일:", ", ".join(changed) + " 바꿈" if changed else "그대로")
    target = ensure_own_layout()
    set_key(ACTION)
    # 앱이 스스로 칸을 넣는지 기다렸다가 없을 때만 넣고, 여러 개면 하나만(두 개면 Ctrl+N 한 번에 탭 두 개)
    ensure_one_block(target, MOD, wait_for_app=True)
    print("Ctrl+N = ccd 새 탭 / 레이아웃:", target, "/ 폴더:", ccd_folder.describe(folder))


def remove():
    set_key(None)
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
    print("제거 완료: Ctrl+N")


if __name__ == "__main__":
    FOLDER_ARG = ccd_folder.parse_arg(sys.argv[1:])
    run_cli(FEATURE, lambda: plan(FOLDER_ARG), lambda: install(FOLDER_ARG), remove)
