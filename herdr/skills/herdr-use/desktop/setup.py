"""herdr 데스크톱 앱 커스텀 일괄 설치·제거·점검.

  python setup.py            # 전부 설치 (여러 번 실행해도 같은 결과)
  python setup.py --remove   # 전부 되돌림
  python setup.py --check    # 지금 상태만 보기 (아무것도 안 바꿈)

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

# (이름, 스크립트, 설명) — 순서 중요: title-sync 가 기본 레이아웃을 my-main 으로 복제·전환한다
STEPS = [
    ("title-sync", "install_title_sync.py", "/rename 하면 상단 탭 이름이 따라감 (+ 기본 레이아웃을 my-main 으로 복제)"),
    ("image-paste", "install_image_paste.py", "Ctrl+Shift+V 로 클립보드 그림 붙여넣기"),
    ("my-agents", "install_agents_name_only.py", "좌하단 Agents: 세션명만 + 지금 하는 일"),
    ("my-tabs", "install_tabs_agent_name.py", "상단 탭: 이름 없는 Claude 탭은 'Claude Code' + 드래그 시 점선"),
    ("ccd 버튼", "install_ccd_button.py", "우상단 + 메뉴에 ccd (claude --dangerously-skip-permissions)"),
    ("Ctrl+N", "install_ccd_key.py", "Ctrl+N 으로 ccd 새 Claude 탭"),
]


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
    for mod in ("title-sync", "image-paste", "my-agents", "my-tabs", "ccd-key"):
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


def install():
    need_app()
    failed = []
    for i, (name, script, desc) in enumerate(STEPS, 1):
        print("\n[%d/%d] %s — %s" % (i, len(STEPS), name, desc))
        if not run_step(script):
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
    print("\n기본 레이아웃(main)으로 전환함. 복제본(layouts/my-main.json, mods/my-agents, mods/my-tabs)은 남겨 둠 —"
          " 완전히 지우려면 README 의 '완전 삭제' 참고.")


if __name__ == "__main__":
    if "--remove" in sys.argv:
        remove()
    elif "--check" in sys.argv:
        check()
    else:
        install()
