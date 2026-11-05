"""herdr 앱 우상단 + 메뉴에 'ccd' 버튼을 넣는다 (claude --dangerously-skip-permissions 로 새 탭).

~/.config/herdr-app/programs.json 에 항목 하나를 더한다. 파일에 다른 항목이 있으면 그대로 둔다.
새 탭은 공간(space)의 폴더에서 열린다 — PowerShell ccd 함수의 Set-Location 역할은 공간 폴더가 한다.
  python install_ccd_button.py            # 추가 (멱등)
  python install_ccd_button.py --remove   # 그 항목만 뺀다
"""
import io
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROGRAMS = os.path.join(APP_HOME, "programs.json")
KEY = "claude-ccd"
ENTRY = {
    "name": "ccd (Claude, 권한 확인 생략)",
    "icon": "icons/claude.svg",
    "tile": "#d97757",
    "run": ["claude", "--dangerously-skip-permissions"],
}


def load():
    if not os.path.exists(PROGRAMS):
        return {}
    with io.open(PROGRAMS, encoding="utf-8") as f:
        return json.load(f)


def save(data):
    if os.path.exists(PROGRAMS) and not os.path.exists(PROGRAMS + ".bak-ccd"):
        shutil.copy2(PROGRAMS, PROGRAMS + ".bak-ccd")
    with io.open(PROGRAMS, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def install():
    data = load()
    programs = data.setdefault("programs", {})
    if programs.get(KEY) == ENTRY:
        print("이미 있음 — + 메뉴 ccd 버튼")
        return
    programs[KEY] = ENTRY
    save(data)
    print("추가 완료: + 메뉴 ccd 버튼 (", PROGRAMS, ")")


def remove():
    data = load()
    if data.get("programs", {}).pop(KEY, None) is not None:
        save(data)
        print("뺌: + 메뉴 ccd 버튼")
    else:
        print("없음 — 할 일 없음")


if __name__ == "__main__":
    remove() if "--remove" in sys.argv else install()
