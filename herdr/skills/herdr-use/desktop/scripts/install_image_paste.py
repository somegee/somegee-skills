"""herdr 앱(Windows)에 image-paste mod를 설치한다 (Ctrl+Shift+V로 클립보드 그림 붙여넣기).

앱은 Windows 로컬 창에 클립보드 '글자'만 붙인다. 이 mod는 Ctrl+Shift+V를 받아
클립보드에 그림이 있으면 clipimg.exe로 PNG 저장 + 클립보드를 '복사한 파일'로 바꾼 뒤
terminal.paste를 불러, 파일을 끌어다 놓은 것처럼 경로가 들어가게 한다.

  python install_image_paste.py            # 설치 (여러 번 실행해도 같은 결과)
  python install_image_paste.py --remove   # 제거 (Ctrl+Shift+V 를 terminal.paste 로 되돌림)

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
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import (  # noqa: E402  같은 폴더의 공용 함수
    APP_HOME, LAYOUTS, SHIPPED, children_lists, ensure_own_layout, find_block, load, save,
)

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MOD = "image-paste"
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", MOD)
MOD_DIR = os.path.join(APP_HOME, "mods", MOD)
KEYS = os.path.join(APP_HOME, "keys.json")
CSC = r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
KEY = "ctrl-shift-v"


def mod_blocks(layout):
    """content.mod == image-paste 인 칸들을 (목록, 칸) 으로 돌려준다(id 는 앱이 무작위로 붙이기도 함)."""
    found = []
    for lst in children_lists(layout):
        for child in lst:
            if isinstance(child, dict) and (child.get("content") or {}).get("mod") == MOD:
                found.append((lst, child))
    return found


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
    with io.open(KEYS, "w", encoding="utf-8") as f:
        f.write(json.dumps(keys, ensure_ascii=False, indent=2))


def install():
    os.makedirs(MOD_DIR, exist_ok=True)
    for name in ("main.js", "mod.json", "clipimg.cs"):
        shutil.copy2(os.path.join(SRC, name), os.path.join(MOD_DIR, name))
    build()
    target = ensure_own_layout()
    set_key(MOD + ".paste")

    blocks = []
    for _ in range(12):  # 앱이 스스로 칸을 넣는지 최대 6초 기다린다
        blocks = mod_blocks(load(target))
        if blocks:
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
    print("설치 완료:", MOD_DIR, "/ 레이아웃:", target, "/ Ctrl+Shift+V =", MOD + ".paste")


def remove():
    set_key("terminal.paste")
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
    print("제거 완료 (그림 저장 폴더 C:\\Users\\Public\\herdr-paste 는 남겨 둠)")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install()
