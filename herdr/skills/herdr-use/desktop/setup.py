"""herdr 데스크톱 앱 커스텀 — 기능별 상태 확인·미리보기·적용을 묶는 얇은 진입점.

  python setup.py                                   # 상태표만 (아무것도 안 바꿈). --status·--check 와 같음, --json 가능
  python setup.py --dry-run [이름,이름]             # 적용하면 쓸 파일·할 일 미리보기 (아무것도 안 씀)
  python setup.py --apply                           # 낡음·없음인 기능만 적용 (최신은 안 건드림, 손으로 고친 흔적은 멈춤)
  python setup.py --apply title-sync,my-spaces      # 고른 기능만 (그중 최신인 건 '변경 없음')
  python setup.py --apply ... --force               # 손으로 고친 흔적이 있어도 백업 후 덮기
  python setup.py --apply ... --ccd-folder "<경로>" # ccd 새 탭(Ctrl+N·+ 메뉴) 폴더 지정 ("" = 지정 해제)
  python setup.py --remove                          # 전부 되돌림

기능 이름: title-sync, image-paste, my-agents, ccd-button, my-tabs, ccd-key, my-spaces
기능 하나만 볼 땐 scripts/install_<…>.py --status / --dry-run 도 된다. 언제 무엇을 돌릴지는 SKILL.md 5절.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import subprocess
import sys
from typing import NamedTuple

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "scripts")
sys.path.insert(0, SCRIPTS)
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)  # 하위 스크립트 출력과 순서 맞춤

from apphome import APP_HOME  # noqa: E402
import ccd_folder  # noqa: E402
import featurelib as fl  # noqa: E402

APP_STATUS_TIMEOUT_SECONDS = 10
KEY_MOD_NOTE = ("키를 받는 mod 를 다시 썼습니다 — 처음 한 번 안 먹으면 앱 창을 한 번 클릭하고, "
                "영문 입력 상태에서 다시 누르세요.")


class Feature(NamedTuple):
    name: str
    module: str
    desc: str
    try_it: str  # 사람이 눌러 볼 것
    takes_folder: bool = False
    takes_key: bool = False  # 키를 받는 mod (다시 쓰면 첫 키가 안 닿을 수 있음)


# 순서 중요: title-sync 가 기본 레이아웃을 my-main 으로 복제·전환한다.
# ccd-button 이 my-tabs 보다 먼저 — my-new-menu 가 있어야 my-tabs 의 + 버튼이 그걸 연다.
FEATURES = [
    Feature("title-sync", "install_title_sync", "/rename 하면 상단 탭 이름이 따라감 (+ 기본 레이아웃을 my-main 으로 복제)",
            "Claude 탭에서 /rename 테스트 → 2초쯤 뒤 상단 탭 이름이 '테스트'"),
    Feature("image-paste", "install_image_paste", "Ctrl+Shift+V 로 클립보드 그림 붙여넣기",
            "Win+Shift+S 로 캡처 → Claude 창에서 Ctrl+Shift+V → 그림 한 장", takes_key=True),
    Feature("my-agents", "install_agents_name_only", "좌하단 Agents: 세션명만 + 지금 하는 일",
            "Claude 가 일하는 중일 때 좌하단 Agents 에 세션명 + 아래 작은 글씨로 하는 일"),
    Feature("ccd-button", "install_ccd_button", "우상단 + 메뉴에 ccd (claude --dangerously-skip-permissions) + my-new-menu",
            "우상단 + → ccd → 새 탭이 정한 폴더(안 정했으면 공간 폴더)에서 열림", takes_folder=True),
    Feature("my-tabs", "install_tabs_agent_name", "상단 탭: 이름 없는 Claude 탭은 'Claude Code' + 끌 때 점선 + + 버튼 → my-new-menu",
            "+ 로 새 Claude 탭 → 탭 이름 'Claude Code' / 탭을 끌면 점선"),
    Feature("ccd-key", "install_ccd_key", "Ctrl+N 으로 ccd 새 Claude 탭",
            "Ctrl+N → 지금 공간에 새 Claude 탭 하나, 폴더는 + 메뉴 ccd 와 같음", takes_folder=True, takes_key=True),
    Feature("my-spaces", "install_spaces_tree", "좌상단 Spaces: ▾/▸ 로 공간별 세션 목록·상태 펼치기",
            "좌상단 ▾/▸ 펼치기·접기 / 세션 줄 누르면 그 창으로 / 다른 공간으로 끌어 옮기기 / 같은 공간 안 순서 바꾸기"),
]
ALIASES = {"ccd 버튼": "ccd-button", "ccd-menu": "ccd-button", "my-new-menu": "ccd-button",
           "ctrl+n": "ccd-key", "title": "title-sync"}
BY_NAME = {f.name: f for f in FEATURES}


def pick(names: str) -> list:
    chosen = []
    for raw in names.split(","):
        name = raw.strip()
        if not name:
            continue
        name = ALIASES.get(name.lower(), ALIASES.get(name, name))
        if name not in BY_NAME:
            sys.exit("모르는 기능 이름: %s — 쓸 수 있는 이름: %s" % (raw.strip(), ", ".join(BY_NAME)))
        if name not in chosen:
            chosen.append(name)
    return chosen


def feature_plan(f: Feature, folder_arg):
    mod = importlib.import_module(f.module)
    return fl.safe_plan(f.name, (lambda: mod.plan(folder_arg)) if f.takes_folder else mod.plan)


def status_all(folder_arg) -> dict:
    return {f.name: fl.evaluate(feature_plan(f, folder_arg)) for f in FEATURES}


def app_line() -> str:
    """앱이 명령을 받는지 — 상태표 자체는 파일만 보므로 앱이 꺼져 있어도 나온다."""
    try:
        from install_title_sync import app_exe
        exe = app_exe()
    except SystemExit:
        return "앱: herdr-app 실행 파일을 못 찾음"
    try:
        r = subprocess.run([exe, "status"], capture_output=True, timeout=APP_STATUS_TIMEOUT_SECONDS)
    except (OSError, subprocess.SubprocessError) as e:
        return "앱: 응답 없음 (%s)" % e
    if r.returncode != 0:
        err = (r.stdout + r.stderr).decode("utf-8", "replace").strip()
        hint = " → 트레이까지 완전히 끄고 다시 켜기" if "10061" in err else ""
        return "앱: 명령을 못 받음%s (%s)" % (hint, err[:120])
    try:
        st = json.loads(r.stdout.decode("utf-8", "replace"))
    except ValueError:
        return "앱: status 응답을 못 읽음"
    return "앱: 레이아웃 %s / 오류 %s" % (st.get("layout"), st.get("errors") or "없음")


def ccd_line() -> str:
    vals = ccd_folder.installed_values()
    key, menu = vals[ccd_folder.KEY_MOD], vals[ccd_folder.MENU_MOD]
    line = "ccd 폴더: " + ccd_folder.describe(key if key is not None else menu)
    if key is not None and menu is not None and key != menu:
        line += " !! Ctrl+N(%s)과 + 메뉴(%s)가 다름" % (ccd_folder.describe(key), ccd_folder.describe(menu))
    return line


def print_status(statuses: dict, as_json: bool) -> int:
    if as_json:
        print(json.dumps({"features": [s.as_dict() for s in statuses.values()], "app": app_line(), "ccd": ccd_line()},
                         ensure_ascii=False, indent=2))
    else:
        for s in statuses.values():
            print(s.line())
        print()
        print(app_line())
        print(ccd_line())
        todo = [n for n, s in statuses.items() if s.state in fl.NEEDS_APPLY]
        if todo:
            print("\n적용하려면: python setup.py --apply  (낡음·없음만: %s)  — 미리보기는 --dry-run" % ", ".join(todo))
        hand = [n for n, s in statuses.items() if s.state == fl.HAND]
        if hand:
            print("손으로 고친 흔적: %s — 시험 적용 중인지 확인한 뒤에만 --apply %s --force (백업 후 덮음)"
                  % (", ".join(hand), ",".join(hand)))
    return 0 if all(s.state == fl.LATEST for s in statuses.values()) else 1


def managed_files(folder_arg) -> list:
    """적용 전후로 시각을 비교할 파일 — 기능 파일 + 섞인 설정 파일 + 레이아웃 전부."""
    paths = {os.path.join(APP_HOME, n) for n in ("keys.json", "programs.json")}
    layouts = os.path.join(APP_HOME, "layouts")
    if os.path.isdir(layouts):
        paths |= {os.path.join(layouts, n) for n in os.listdir(layouts) if n.endswith(".json")}
    for f in FEATURES:
        paths |= {w.path for w in feature_plan(f, folder_arg).files}
    return sorted(paths)


def snapshot(paths: list) -> dict:
    out = {}
    for p in paths:
        try:
            out[p] = os.stat(p).st_mtime_ns
        except OSError:
            out[p] = None
    return out


def run_script(f: Feature, folder_arg, force: bool) -> int:
    args = [sys.executable, os.path.join(SCRIPTS, f.module + ".py")]
    if f.takes_folder and folder_arg is not None:
        args += [ccd_folder.OPTION, folder_arg]
    if force:
        args.append("--force")
    return subprocess.run(args).returncode


def apply(names, folder_arg, force: bool) -> int:
    before = status_all(folder_arg)
    # 이름 없이 부르면 낡음·없음 + 손으로 고친 흔적(--force 가 없으면 멈춤으로 보고만)
    chosen = pick(names) if names else [n for n, s in before.items() if s.state in fl.NEEDS_APPLY + (fl.HAND,)]
    if not chosen:
        print("낡음·없음인 기능이 없음 — 바꿀 것 없음")
        return print_status(before, False)
    paths = managed_files(folder_arg)
    t0 = snapshot(paths)
    changed, held, failed = [], [], []
    for f in FEATURES:
        if f.name not in chosen:
            continue
        st = fl.evaluate(feature_plan(f, folder_arg))  # 앞 기능이 같이 고쳤을 수 있다(ccd-button → my-tabs)
        if st.state == fl.LATEST:
            print("[%s] 변경 없음" % f.name)
            continue
        if st.state in (fl.PATCH, fl.ERROR):
            print("[%s] %s — 건너뜀" % (f.name, st.line().split(None, 1)[1]))
            failed.append(f.name)
            continue
        if st.state == fl.HAND and not force:
            print("[%s] 멈춤: %s" % (f.name, st.detail))
            held.append(f.name)
            continue
        print("\n[%s] %s — %s" % (f.name, f.desc, st.line().split(None, 1)[1]))
        (changed if run_script(f, folder_arg, force) == 0 else failed).append(f.name)
    after = status_all(folder_arg)
    touched = [p for p, t in snapshot(paths).items() if t != t0.get(p)]
    report(chosen, changed, held, failed, after, touched)
    return 1 if failed or held else 0


def report(chosen, changed, held, failed, after, touched) -> None:
    print("\n===== 결과 =====")
    for s in after.values():
        print(s.line())
    print()
    print("바뀐 기능:", ", ".join(changed) or "없음")
    broken = [n for n, s in after.items() if s.state in (fl.PATCH, fl.ERROR) and n not in failed]
    print("그대로인 기능:", ", ".join(n for n in BY_NAME if n not in changed + held + failed + broken) or "없음")
    if broken:
        print("확인 필요(오류·고칠 문장 못 찾음, 안 골라서 그대로 둠):", ", ".join(broken))
    if held:
        print("멈춘 기능(손으로 고친 흔적):", ", ".join(held),
              "→ 시험 적용 중인지 확인한 뒤 덮으려면 --apply %s --force (백업: %s)" % (",".join(held), fl.BACKUP_DIR))
    if failed:
        print("실패·건너뜀:", ", ".join(failed), "→ 위 메시지 확인")
    not_latest = [n for n in chosen if after[n].state != fl.LATEST and n not in held]
    if not_latest:
        print("아직 최신 아님:", ", ".join(not_latest))
    print("바뀐 파일:", ", ".join(fl.rel(p) for p in touched) or "없음")
    if "ccd-button" in changed and "my-tabs" not in chosen and any("my-tabs" in fl.rel(p) for p in touched):
        print("  (my-tabs 는 ccd-button 이 + 버튼 연결을 맞추느라 같이 다시 만들었습니다)")
    print(app_line())
    if changed:
        print("\n사람이 눌러 볼 것 (바뀐 기능만):")
        for n in changed:
            print("  - %s: %s" % (n, BY_NAME[n].try_it))
        if any(BY_NAME[n].takes_key for n in changed):
            print("  ※ " + KEY_MOD_NOTE)


def dry_run(names, folder_arg) -> int:
    before = status_all(folder_arg)
    chosen = pick(names) if names else [n for n, s in before.items() if s.state != fl.LATEST]
    if not chosen:
        print("모두 최신 — 할 일 없음")
    for f in FEATURES:
        if f.name in chosen:
            fl.dry_run(feature_plan(f, folder_arg))
    print("\n(아무 파일도 쓰지 않았습니다)")
    return 0


def remove() -> None:
    for f in reversed(FEATURES):
        print("\n[되돌림]", f.name)
        subprocess.run([sys.executable, os.path.join(SCRIPTS, f.module + ".py"), "--remove"])
    from install_title_sync import app_exe
    subprocess.run([app_exe(), "do", "layout.switch", json.dumps({"name": "main"})])
    print("\n기본 레이아웃(main)으로 전환함. 복제본(layouts/my-main.json, mods/my-agents, mods/my-tabs, mods/my-spaces)은 남겨 둠 —"
          " 완전히 지우려면 README 의 '완전 삭제' 참고. (mods/my-new-menu 는 지움)")


def main() -> int:
    ap = argparse.ArgumentParser(description="herdr 데스크톱 커스텀: 기본은 상태표(아무것도 안 바꿈)")
    ap.add_argument("--status", action="store_true", help="상태표 (기본 동작)")
    ap.add_argument("--check", action="store_true", help="--status 와 같음")
    ap.add_argument("--json", action="store_true", help="상태표를 JSON 으로")
    ap.add_argument("--apply", nargs="?", const="", default=None, metavar="이름,이름", help="낡음·없음 적용, 또는 고른 기능만")
    ap.add_argument("--dry-run", nargs="?", const="", default=None, metavar="이름,이름", help="미리보기")
    ap.add_argument("--force", action="store_true", help="손으로 고친 흔적도 백업 후 덮기")
    ap.add_argument("--remove", action="store_true", help="전부 되돌리기")
    ap.add_argument(ccd_folder.OPTION, dest="ccd_folder", default=None, metavar="경로", help='ccd 새 탭 폴더 ("" = 해제)')
    a = ap.parse_args()
    folder_arg = ccd_folder.clean(a.ccd_folder) if a.ccd_folder is not None else None
    if a.remove:
        remove()
        return 0
    if a.apply is not None:
        return apply(a.apply, folder_arg, a.force)
    if a.dry_run is not None:
        return dry_run(a.dry_run, folder_arg)
    if folder_arg is not None:
        print("※ --ccd-folder 만 주면 그 폴더 기준 상태만 봅니다. 적용하려면 --apply ccd-button,ccd-key --ccd-folder ...\n")
    return print_status(status_all(folder_arg), a.json)


if __name__ == "__main__":
    sys.exit(main())
