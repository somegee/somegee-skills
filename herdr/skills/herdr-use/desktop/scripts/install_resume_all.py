"""herdr 앱(Windows)에 resume-all mod 를 설치한다 (재부팅 뒤 셸만 남은 Claude 세션 골라서 일괄 이어하기).

재부팅·로그아웃·core 재시작 뒤 터미널은 같은 주소·이름표로 셸만 다시 뜨고 claude 는 다시 안 돈다.
플러그인 훅(hooks/label_session.py)이 붙인 claude.session·claude.project 이름표는 남으므로,
이 mod(팝업)가 그런 셸을 골라 각 셸에 `claude --resume <id> [권한 옵션]` 을 입력한다.
팝업을 여는 우상단 `Resume` 버튼은 my-tabs 안에 있다 → 설치·제거 뒤 my-tabs 를 다시 맞춘다(refresh).

  python install_resume_all.py            # 낡음·없음이면 설치, 최신이면 '변경 없음'
  python install_resume_all.py --status   # 상태 한 줄(--json) / --dry-run 미리보기
  python install_resume_all.py --remove   # mod 폴더를 지우고 my-tabs 에서 Resume 버튼을 뺀다
팝업 mod(place: none)라 레이아웃 칸은 없다. 같은 내용이면 mod 파일을 다시 쓰지 않는다.
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME, asset_wants, copy_assets  # noqa: E402
from featurelib import Plan, run_cli  # noqa: E402
import install_tabs_agent_name  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEATURE = MOD = install_tabs_agent_name.RESUME_MOD
FILES = ("main.js", "read_sessions.ps1", "mod.json", "resume.svg")
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", MOD)
MOD_DIR = os.path.join(APP_HOME, "mods", MOD)


def plan():
    return Plan(FEATURE, files=asset_wants(SRC, MOD_DIR, FILES),
                present=os.path.exists(os.path.join(MOD_DIR, "main.js")))


def install():
    changed = copy_assets(SRC, MOD_DIR, FILES)
    print("mod 파일:", ", ".join(changed) + " 바꿈" if changed else "그대로")
    install_tabs_agent_name.refresh()  # my-tabs 가 있으면 Resume 버튼을 넣는다(없으면 my-tabs 설치 때 들어감)


def remove():
    if os.path.exists(MOD_DIR):
        shutil.rmtree(MOD_DIR, ignore_errors=True)
        print("지움:" if not os.path.exists(MOD_DIR) else "!! 못 지움(앱이 잡고 있는 듯, 손으로 지우세요):", MOD_DIR)
    else:
        print("없음 —", MOD_DIR)
    install_tabs_agent_name.refresh()  # 없는 mod 를 여는 버튼이 남지 않게


if __name__ == "__main__":
    run_cli(FEATURE, plan, install, remove)
