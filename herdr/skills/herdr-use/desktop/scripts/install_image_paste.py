"""herdr 앱(Windows)에 image-paste mod를 설치한다 (Ctrl+Shift+V로 클립보드 그림 붙여넣기).

앱은 Windows 로컬 창에 클립보드 '글자'만 붙인다. 이 mod는 Ctrl+Shift+V를 받아
클립보드에 그림이 있으면 clipimg.exe로 PNG 저장 + 클립보드를 '복사한 파일'로 바꾼 뒤
terminal.paste를 불러, 파일을 끌어다 놓은 것처럼 경로가 들어가게 한다.

  python install_image_paste.py            # 낡음·없음이면 설치, 최신이면 '변경 없음'
  python install_image_paste.py --status   # 상태 한 줄(--json) / --dry-run 미리보기
  python install_image_paste.py --remove   # 제거 (Ctrl+Shift+V 를 terminal.paste 로 되돌림)
같은 내용이면 mod 파일을 다시 쓰지 않고, clipimg.exe 는 clipimg.cs 가 바뀌었거나 없을 때만 다시 빌드한다.

주의: 단축키가 image-paste.paste 를 가리키면 앱이 레이아웃에 mod 칸을 스스로 넣는다.
손으로 또 넣으면 mod가 두 번 돌아 그림이 두 장 붙는다 → 이 스크립트는 기다렸다가 없을 때만 넣고,
여러 개면 하나만 남긴다.
"""
import io
import json
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import (  # noqa: E402  같은 폴더의 공용 함수
    APP_HOME, LAYOUTS, SHIPPED, asset_wants, block_check, copy_assets, ensure_one_block, ensure_own_layout,
    load, mod_blocks, save, target_layout,
)
from featurelib import KEYS, Check, Plan, keys_check, run_cli, write_json_if_changed  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEATURE = MOD = "image-paste"
FILES = ("main.js", "mod.json", "clipimg.cs")
ACTION = MOD + ".paste"
EXE = os.path.join(APP_HOME, "mods", MOD, "clipimg.exe")
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", MOD)
MOD_DIR = os.path.join(APP_HOME, "mods", MOD)
CSC = r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
KEY = "ctrl-shift-v"


def build():
    if not os.path.exists(CSC):
        sys.exit("csc.exe 없음(.NET Framework 4) — " + CSC)
    r = subprocess.run([CSC, "/nologo", "/target:winexe", "/out:clipimg.exe", "clipimg.cs"],
                       cwd=MOD_DIR, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("clipimg.exe 빌드 실패:\n" + r.stdout + r.stderr)


def set_key(value):
    with io.open(KEYS, encoding="utf-8") as f:
        keys = json.load(f)
    term = keys.setdefault("terminal", {})
    if term.get(KEY) == value:
        return
    backup = KEYS + ".bak-imagepaste"
    if not os.path.exists(backup):
        shutil.copy2(KEYS, backup)
    term[KEY] = value
    write_json_if_changed(KEYS, keys)
    print("keys.json: Ctrl+Shift+V =", value)


def plan():
    target = target_layout()
    return Plan(FEATURE, files=asset_wants(SRC, MOD_DIR, FILES),
                checks=(Check("clipimg.exe 없음", os.path.exists(EXE), "clipimg.exe 빌드(csc)"),
                        keys_check("terminal", KEY, ACTION, "Ctrl+Shift+V"),
                        block_check(target, MOD)),
                present=os.path.exists(os.path.join(MOD_DIR, "main.js")))


def install():
    changed = copy_assets(SRC, MOD_DIR, FILES)
    print("mod 파일:", ", ".join(changed) + " 바꿈" if changed else "그대로")
    if "clipimg.cs" in changed or not os.path.exists(EXE):
        try:
            os.remove(EXE)  # 빌드가 실패하면 '없음'으로 남아 다음 상태 확인에 잡히게
        except OSError:
            pass
        build()
        print("clipimg.exe 빌드함")
    target = ensure_own_layout()
    set_key(ACTION)
    ensure_one_block(target, MOD, wait_for_app=True)
    print("레이아웃:", target, "/ Ctrl+Shift+V =", ACTION)


def remove():
    set_key("terminal.paste")
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
    print("제거 완료 (그림 저장 폴더 C:\\Users\\Public\\herdr-paste 는 남겨 둠)")


if __name__ == "__main__":
    run_cli(FEATURE, plan, install, remove)
