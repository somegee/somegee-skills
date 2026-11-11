"""herdr 데스크톱 앱 커스텀 일괄 설치·제거·점검.

  python setup.py                          # 전부 설치 (여러 번 실행해도 같은 결과)
  python setup.py --ccd-folder "<경로>"    # 설치 + ccd 새 탭(Ctrl+N·+ 메뉴)을 그 폴더에서 열기 ("" = 지정 해제)
  python setup.py --remove                 # 전부 되돌림
  python setup.py --check                  # 지금 상태만 보기 (아무것도 안 바꿈)

--ccd-folder 를 안 주면 이미 설치된 폴더를 유지한다(처음이면 PowerShell 프로필의 ccd 함수에서 찾아 보고, 없으면 공간 폴더).
herdr 앱이 켜져 있어야 한다(레이아웃·mod 복제를 앱에 시킨다). 자세한 내용은 README.md.
"""
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "scripts")
sys.path.insert(0, SCRIPTS)
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)  # 하위 스크립트 출력과 순서 맞춤

from install_title_sync import APP_HOME, app_exe  # noqa: E402
from patchlib import mod_js  # noqa: E402
import ccd_folder  # noqa: E402

# (이름, 스크립트, 설명) — 순서 중요: title-sync 가 기본 레이아웃을 my-main 으로 복제·전환한다.
# ccd 버튼이 my-tabs 보다 먼저 — my-new-menu 가 있어야 my-tabs 의 + 버튼이 그걸 연다.
STEPS = [
    ("title-sync", "install_title_sync.py", "/rename 하면 상단 탭 이름이 따라감 (+ 기본 레이아웃을 my-main 으로 복제)"),
    ("image-paste", "install_image_paste.py", "Ctrl+Shift+V 로 클립보드 그림 붙여넣기"),
    ("my-agents", "install_agents_name_only.py", "좌하단 Agents: 세션명만 + 지금 하는 일"),
    ("ccd 버튼", "install_ccd_button.py", "우상단 + 메뉴에 ccd (claude --dangerously-skip-permissions) + my-new-menu"),
    ("my-tabs", "install_tabs_agent_name.py", "상단 탭: 이름 없는 Claude 탭은 'Claude Code' + 드래그 시 점선 + + 버튼 → my-new-menu"),
    ("Ctrl+N", "install_ccd_key.py", "Ctrl+N 으로 ccd 새 Claude 탭"),
    ("my-spaces", "install_spaces_tree.py", "좌상단 Spaces: ▾/▸ 로 공간별 세션 목록·상태 펼치기"),
]
CCD_SCRIPTS = {"install_ccd_button.py", "install_ccd_key.py"}  # --ccd-folder 를 넘겨 줄 단계


def status():
    r = subprocess.run([app_exe(), "status"], capture_output=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout.decode("utf-8", "replace"))
    except ValueError:
        return None


def need_app():
    st = status()
    if st is None:
        sys.exit("herdr 앱이 꺼져 있거나 응답이 없음 — 앱을 켠 뒤 다시 실행하세요.")
    return st


def run_step(script, *args):
    r = subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args])
    return r.returncode == 0


def count_mod(layout_name, mod):
    path = os.path.join(APP_HOME, "layouts", layout_name + ".json")
    if not os.path.exists(path):
        return 0
    with io.open(path, encoding="utf-8") as f:
        return f.read().count('"mod": "%s"' % mod)


def check():
    st = need_app()
    layout = st.get("layout")
    print("지금 레이아웃:", layout, "(my-main 이어야 커스텀이 보임)")
    print("앱 오류:", st.get("errors") or "없음")
    for mod in ("title-sync", "image-paste", "my-agents", "my-tabs", "ccd-key", "my-spaces"):
        n = count_mod(layout, mod)
        print("  %-12s 칸 %d개 %s" % (mod, n, "OK" if n == 1 else ("없음" if n == 0 else "중복! 하나만 남겨야 함")))
    try:
        with io.open(os.path.join(APP_HOME, "keys.json"), encoding="utf-8") as f:
            keys = json.load(f)
    except (OSError, ValueError):
        keys = {}
    print("  Ctrl+Shift+V  =", keys.get("terminal", {}).get("ctrl-shift-v"))
    print("  Ctrl+N        =", keys.get("global", {}).get("ctrl-n"))
    try:
        with io.open(os.path.join(APP_HOME, "programs.json"), encoding="utf-8") as f:
            has = "claude-ccd" in json.load(f).get("programs", {})
    except (OSError, ValueError):
        has = False
    print("  + 메뉴 ccd     =", "있음" if has else "없음")
    check_new_menu()
    check_ccd_folder()


def read_file(path):
    try:
        with io.open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def check_new_menu():
    """my-new-menu 는 팝업이라 레이아웃 칸이 없다 → 파일과 my-tabs 의 + 버튼 연결만 본다."""
    has_file = os.path.exists(mod_js("my-new-menu"))
    linked = 'mod: "my-new-menu"' in read_file(mod_js("my-tabs"))
    if has_file and linked:
        state = "파일 있음 · + 버튼 연결 OK"
    elif has_file:
        state = "파일 있음 · + 버튼 연결 안 됨 (my-tabs 다시 설치)"
    elif linked:
        state = "파일 없음인데 + 버튼이 가리킴! + 버튼이 안 열림 → 설치 다시"
    else:
        state = "없음"
    print("  %-12s %s" % ("my-new-menu", state))


def check_ccd_folder():
    vals = ccd_folder.installed_values()
    key, menu = vals[ccd_folder.KEY_MOD], vals[ccd_folder.MENU_MOD]
    print("  ccd 폴더 =", ccd_folder.describe(key if key is not None else menu))
    if key is not None and menu is not None and key != menu:
        print("  !! ccd 폴더가 서로 다름 — Ctrl+N: %s / + 메뉴: %s → setup.py --ccd-folder 로 다시 맞추기"
              % (ccd_folder.describe(key), ccd_folder.describe(menu)))


def install(folder_arg):
    need_app()
    folder = ccd_folder.resolve(folder_arg)
    print("ccd 새 탭 폴더:", ccd_folder.describe(folder))
    failed = []
    for i, (name, script, desc) in enumerate(STEPS, 1):
        print("\n[%d/%d] %s — %s" % (i, len(STEPS), name, desc))
        extra = [ccd_folder.OPTION, folder] if script in CCD_SCRIPTS else []
        if not run_step(script, *extra):
            failed.append(name)
            print("  !! 실패 — 위 메시지 확인. 나머지는 계속 진행")
    print("\n===== 결과 =====")
    check()
    if failed:
        print("\n실패한 단계:", ", ".join(failed))
        sys.exit(1)
    print("\n완료. README.md 의 '확인 방법' 대로 눌러 보세요.")


def remove():
    need_app()
    for name, script, _ in reversed(STEPS):
        print("\n[되돌림]", name)
        run_step(script, "--remove")
    subprocess.run([app_exe(), "do", "layout.switch", json.dumps({"name": "main"})])
    print("\n기본 레이아웃(main)으로 전환함. 복제본(layouts/my-main.json, mods/my-agents, mods/my-tabs, mods/my-spaces)은 남겨 둠 —"
          " 완전히 지우려면 README 의 '완전 삭제' 참고. (mods/my-new-menu 는 지움)")


if __name__ == "__main__":
    if "--remove" in sys.argv:
        remove()
    elif "--check" in sys.argv:
        check()
    else:
        install(ccd_folder.parse_arg(sys.argv[1:]))
