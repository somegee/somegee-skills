"""herdr 데스크톱 앱 커스텀 — 기능별 상태 확인·미리보기·적용을 묶는 얇은 진입점.

  python setup.py                                   # 상태표만 (아무것도 안 바꿈). --status·--check 와 같음, --json 가능
  python setup.py --dry-run [이름,이름]             # 적용하면 쓸 파일·할 일 미리보기 (아무것도 안 씀)
  python setup.py --apply                           # 낡음·없음인 기능만 적용 (최신은 안 건드림, 손으로 고친 흔적은 멈춤)
  python setup.py --apply title-sync,my-spaces      # 고른 기능만 (그중 최신인 건 '변경 없음')
  python setup.py --apply ... --force               # 손으로 고친 흔적이 있어도 백업 후 덮기
  python setup.py --mine [--layout <이름>]          # 내 세팅 그대로: 모든 기능 + 앱 설정을 한 번에 (최신은 안 건드림, 손으로 고친 흔적은 멈춤)
  python setup.py --apply ... --layout <이름>       # 얹을 레이아웃 고르기: 있는 이름이면 거기에 얹고, 없는 이름이면 main 을 복제해 새로 만듦
                                                    #   (안 주면 지금 보이는 내 레이아웃, 기본 레이아웃을 쓰는 중이면 my-<이름> 으로 복제)
  python setup.py --remove                          # 전부 되돌림
  python setup.py --choices --json                  # 고르기 화면용: 묶음별 기능·지금 상태·추천·함께 필요한 기능 (아무것도 안 바꿈)

기능 이름: title-sync, image-paste, my-agents, resume-all, claude-notes, my-tabs, newtab-key, my-spaces, app-settings
기능 하나만 볼 땐 scripts/install_<…>.py --status / --dry-run 도 된다. 언제 무엇을 돌릴지는 SKILL.md 2갈래(2-3 행동 가이드).
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
import featurelib as fl  # noqa: E402

APP_STATUS_TIMEOUT_SECONDS = 10
KEY_MOD_NOTE = ("키를 받는 mod 를 다시 썼습니다 — 처음 한 번 안 먹으면 앱 창을 한 번 클릭하고, "
                "영문 입력 상태에서 다시 누르세요.")


class Feature(NamedTuple):
    name: str
    module: str
    desc: str
    try_it: str  # 사람이 눌러 볼 것
    takes_key: bool = False  # 키를 받는 mod (다시 쓰면 첫 키가 안 닿을 수 있음)


# 순서 중요: title-sync 가 기본 레이아웃을 my-main 으로 복제·전환한다.
# resume-all·claude-notes 가 my-tabs 보다 먼저 — 그 mod 가 있어야 my-tabs 의 Resume·Notes 버튼이 그걸 연다.
FEATURES = [
    Feature("title-sync", "install_title_sync", "/rename 하면 상단 탭 이름이 따라감 (+ 기본 레이아웃을 my-main 으로 복제)",
            "Claude 탭에서 /rename 테스트 → 2초쯤 뒤 상단 탭 이름이 '테스트'"),
    Feature("image-paste", "install_image_paste", "Ctrl+Shift+V 로 클립보드 그림 붙여넣기",
            "Win+Shift+S 로 캡처 → Claude 창에서 Ctrl+Shift+V → 그림 한 장", takes_key=True),
    Feature("my-agents", "install_agents_name_only", "좌하단 Agents: 세션명만 + 지금 하는 일 + 우클릭 「끝남으로 표시」",
            "Claude 가 일하는 중일 때 좌하단 Agents 에 세션명 + 아래 작은 글씨로 하는 일 / 쉬는 중 줄 우클릭 → 「끝남으로 표시」 → 끝남(채운 점)으로 바뀜"),
    Feature("resume-all", "install_resume_all", "우상단 Resume: 재부팅 뒤 셸만 남은 Claude 세션 골라서 일괄 이어하기",
            "hc server stop → hc server start(herdr 밖 PowerShell 에서) → 우상단 Resume N → 팝업에서 이어하기 → 각 탭에 claude 가 이전 대화로 열림"),
    Feature("claude-notes", "install_claude_notes", "우상단 Notes: 보고 있는 Claude 세션의 notes 를 오른쪽 패널에서 보기(notes 플러그인 0.22.0+ 는 herdr 안에서 TUI 옆 창을 숨김)",
            "Claude 탭을 누른 채 우상단 Notes → 오른쪽 패널에 그 세션 notes 탭 / 다른 공간의 Claude 탭을 눌러도 패널은 열린 채 2초 안에 그 세션 노트로 / Notes 한 번 더 → 접힘"),
    Feature("my-tabs", "install_tabs_agent_name", "상단 탭: 이름 없는 Claude 탭 이름(앱 0.1.15 까지) + 끌 때 점선 + x 두 번 눌러 닫기 + 우상단 Resume·Notes 버튼(그 기능이 있을 때)",
            "+ 로 새 Claude 탭 → 탭 이름이 번호가 아님(Claude Code 또는 Claude 제목) / 탭을 끌면 점선 / x 한 번 → 빨갛게, 3초 안에 한 번 더 → 닫힘 / 우상단 Files 왼쪽에 Resume 버튼"),
    Feature("newtab-key", "install_newtab_key", "Ctrl+N → 새 터미널 탭(앱 자체 tab.new, 예전 ccd-key 치움)",
            "Ctrl+N → 지금 공간에 새 터미널 탭 하나"),
    Feature("my-spaces", "install_spaces_tree", "좌상단 Spaces: ▾/▸ 로 공간별 세션 목록·상태 펼치기",
            "좌상단 ▾/▸ 펼치기·접기 / 세션 줄 누르면 그 창으로 / 다른 공간으로 끌어 옮기기 / 같은 공간 안 순서 바꾸기"),
    Feature("app-settings", "install_app_settings", "앱 설정: 어두운 화면 + 사용 통계 안 보냄 (settings.json 두 항목만)",
            "앱 화면이 어두운 테마 (안 바뀌면 앱을 다시 켜기)"),
]
ALIASES = {"ctrl+n": "newtab-key", "ccd-key": "newtab-key", "title": "title-sync", "resume": "resume-all", "notes": "claude-notes",
           "settings": "app-settings", "설정": "app-settings"}
BY_NAME = {f.name: f for f in FEATURES}

# 고르기 화면(SKILL.md 「인자」 — AskUserQuestion 다중 선택)용 묶음. 질문 하나에 선택지 4개까지라 4개 이하로 묶는다.
# 묶음 이름은 질문 머리표(12자 이하), SHORT 는 선택지 이름(다섯 낱말 이하).
GROUPS = [
    ("화면", ("my-tabs", "my-spaces", "my-agents", "title-sync")),
    ("우상단 버튼", ("resume-all", "claude-notes")),
    ("키·설정", ("image-paste", "newtab-key", "app-settings")),
]
SHORT = {
    "my-tabs": "상단 탭 바", "my-spaces": "좌상단 Spaces 펼치기", "my-agents": "좌하단 Agents 목록",
    "title-sync": "/rename → 탭 이름", "resume-all": "Resume 버튼: 세션 이어하기", "claude-notes": "Notes 버튼: 노트 패널",
    "image-paste": "Ctrl+Shift+V 그림 붙여넣기", "newtab-key": "Ctrl+N 새 터미널 탭",
    "app-settings": "어두운 화면·통계 끔",
}
# 이 기능의 버튼이 들어가 있는 곳 — 같이 깔리지 않으면 눌러 볼 데가 없다
NEEDS = {"resume-all": ("my-tabs",), "claude-notes": ("my-tabs",)}


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


def feature_plan(f: Feature):
    return fl.safe_plan(f.name, importlib.import_module(f.module).plan)


def status_all() -> dict:
    return {f.name: fl.evaluate(feature_plan(f)) for f in FEATURES}


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


def layout_info() -> dict:
    """레이아웃 고르기 질문용 — 지금 보이는 것, 내 레이아웃 목록, 안 고르면 얹힐 곳."""
    from install_title_sync import LAYOUT_ENV, SHIPPED, own_layouts, shown_layout, target_layout
    shown = shown_layout()
    return {"shown": shown, "shown_is_shipped": shown in SHIPPED, "own": own_layouts(),
            "target": target_layout(), "chosen": os.environ.get(LAYOUT_ENV) or None, "new_default": "my-main"}


def addon_rows() -> list:
    import addons
    return addons.status()


def addons_lines(rows=None) -> list:
    """각자 덧붙인 기능(.herdr-custom/addons) — 복제본을 다시 만들 때도 같이 들어간다. 없으면 빈 목록.
    못 넣은 것은 '!!' 로 시작한다 — 기능 상태는 '최신'이어도 그 버튼·코드가 빠진 채 만들어진 것."""
    import addons
    rows = addons.status() if rows is None else rows
    lines = []
    for r in rows:
        where = r["clone"] or "파일"
        lines.append(("!! %s: %s 못 넣음 — %s" % (where, r["name"], r["problem"])) if r["problem"] else "%s: %s 들어감" % (where, r["name"]))
    return lines


def layout_line() -> str:
    info = layout_info()
    own = ", ".join(info["own"]) or "없음"
    return "레이아웃: 지금 %s / 얹힐 곳 %s / 내 레이아웃 %s" % (info["shown"], info["target"], own)


def print_status(statuses: dict, as_json: bool) -> int:
    if as_json:
        print(json.dumps({"features": [s.as_dict() for s in statuses.values()], "app": app_line(), "layout": layout_info(), "addons": addon_rows()},
                         ensure_ascii=False, indent=2))
    else:
        for s in statuses.values():
            print(s.line())
        print()
        print(app_line())
        print(layout_line())
        for line in addons_lines():
            print("덧붙이기 —", line)
        todo = [n for n, s in statuses.items() if s.state in fl.NEEDS_APPLY]
        if todo:
            print("\n적용하려면: python setup.py --apply  (낡음·없음만: %s)  — 미리보기는 --dry-run" % ", ".join(todo))
        hand = [n for n, s in statuses.items() if s.state == fl.HAND]
        if hand:
            print("손으로 고친 흔적: %s — 시험 적용 중인지 확인한 뒤에만 --apply %s --force (백업 후 덮음)"
                  % (", ".join(hand), ",".join(hand)))
    return 0 if all(s.state == fl.LATEST for s in statuses.values()) else 1


def choices(statuses: dict) -> dict:
    """고르기 화면용 묶음. recommended = 낡음·없음(적용하면 바뀜). 손으로 고친 흔적·고칠 문장 못 찾음은 따로 표시."""
    groups = []
    for title, names in GROUPS:
        items = []
        for n in names:
            st = statuses[n]
            items.append({"name": n, "label": SHORT[n], "desc": BY_NAME[n].desc, "state": st.state, "state_label": st.label,
                          "detail": st.detail, "recommended": st.state in fl.NEEDS_APPLY, "needs": list(NEEDS.get(n, ()))})
        groups.append({"title": title, "features": items})
    return {"groups": groups, "app": app_line(), "layout": layout_info(), "addons": addons_lines()}


def managed_files() -> list:
    """적용 전후로 시각을 비교할 파일 — 기능 파일 + 섞인 설정 파일 + 레이아웃 전부."""
    paths = {os.path.join(APP_HOME, n) for n in ("keys.json", "programs.json", "settings.json")}
    layouts = os.path.join(APP_HOME, "layouts")
    if os.path.isdir(layouts):
        paths |= {os.path.join(layouts, n) for n in os.listdir(layouts) if n.endswith(".json")}
    for f in FEATURES:
        paths |= {w.path for w in feature_plan(f).files}
    return sorted(paths)


def snapshot(paths: list) -> dict:
    out = {}
    for p in paths:
        try:
            out[p] = os.stat(p).st_mtime_ns
        except OSError:
            out[p] = None
    return out


def run_script(f: Feature, force: bool) -> int:
    args = [sys.executable, os.path.join(SCRIPTS, f.module + ".py")]
    if force:
        args.append("--force")
    return subprocess.run(args).returncode


def apply(names, force: bool) -> int:
    before = status_all()
    for f in FEATURES:  # 플러그인판과 같은 설치본은 기록만 남긴다(mod 파일은 안 건드림) — 손으로 고친 흔적을 가리려고
        if before[f.name].state in (fl.LATEST, fl.STALE, fl.MISSING):
            fl.adopt(feature_plan(f))
    # 이름 없이 부르면 낡음·없음 + 손으로 고친 흔적(--force 가 없으면 멈춤으로 보고만)
    chosen = pick(names) if names else [n for n, s in before.items() if s.state in fl.NEEDS_APPLY + (fl.HAND,)]
    if not chosen:
        print("낡음·없음인 기능이 없음 — 바꿀 것 없음")
        return print_status(before, False)
    paths = managed_files()
    t0 = snapshot(paths)
    changed, held, failed = [], [], []
    for f in FEATURES:
        if f.name not in chosen:
            continue
        st = fl.evaluate(feature_plan(f))  # 앞 기능이 같이 고쳤을 수 있다(resume-all → my-tabs)
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
        (changed if run_script(f, force) == 0 else failed).append(f.name)
    after = status_all()
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
    linked = [n for n in ("resume-all", "claude-notes") if n in changed]
    if linked and "my-tabs" not in chosen and any("my-tabs" in fl.rel(p) for p in touched):
        print("  (my-tabs 는 %s 이 버튼 연결을 맞추느라 같이 다시 만들었습니다)" % "·".join(linked))
    print(app_line())
    print(layout_line())
    for line in addons_lines():
        print("덧붙이기 —", line)
    if changed:
        print("\n사람이 눌러 볼 것 (바뀐 기능만):")
        for n in changed:
            print("  - %s: %s" % (n, BY_NAME[n].try_it))
        if any(BY_NAME[n].takes_key for n in changed):
            print("  ※ " + KEY_MOD_NOTE)


def dry_run(names) -> int:
    before = status_all()
    chosen = pick(names) if names else [n for n, s in before.items() if s.state != fl.LATEST]
    if not chosen:
        print("모두 최신 — 할 일 없음")
    for f in FEATURES:
        if f.name in chosen:
            fl.dry_run(feature_plan(f))
    print("\n(아무 파일도 쓰지 않았습니다)")
    return 0


def remove() -> None:
    for f in reversed(FEATURES):
        print("\n[되돌림]", f.name)
        subprocess.run([sys.executable, os.path.join(SCRIPTS, f.module + ".py"), "--remove"])
    from install_title_sync import app_exe
    subprocess.run([app_exe(), "do", "layout.switch", json.dumps({"name": "main"})])
    print("\n기본 레이아웃(main)으로 전환함. 복제본(layouts/my-main.json, mods/my-agents, mods/my-tabs, mods/my-spaces)은 남겨 둠 —"
          " 완전히 지우려면 README 의 '완전 삭제' 참고. (mods/resume-all·claude-notes 는 지움)")


def main() -> int:
    ap = argparse.ArgumentParser(description="herdr 데스크톱 커스텀: 기본은 상태표(아무것도 안 바꿈)")
    ap.add_argument("--status", action="store_true", help="상태표 (기본 동작)")
    ap.add_argument("--check", action="store_true", help="--status 와 같음")
    ap.add_argument("--json", action="store_true", help="상태표를 JSON 으로")
    ap.add_argument("--apply", nargs="?", const="", default=None, metavar="이름,이름", help="낡음·없음 적용, 또는 고른 기능만")
    ap.add_argument("--dry-run", nargs="?", const="", default=None, metavar="이름,이름", help="미리보기")
    ap.add_argument("--force", action="store_true", help="손으로 고친 흔적도 백업 후 덮기")
    ap.add_argument("--mine", action="store_true", help="내 세팅 그대로: 모든 기능 + 앱 설정을 한 번에")
    ap.add_argument("--remove", action="store_true", help="전부 되돌리기")
    ap.add_argument("--choices", action="store_true", help="고르기 화면용 묶음(--json 과 함께, 아무것도 안 바꿈)")
    ap.add_argument("--layout", default=None, metavar="이름", help="얹을 레이아웃(있으면 거기, 없으면 main 복제로 새로)")
    a = ap.parse_args()
    if a.layout is not None:
        from install_title_sync import LAYOUT_ENV, chosen_layout
        os.environ[LAYOUT_ENV] = a.layout.strip()  # 하위 기능 스크립트도 같은 값을 받는다
        chosen_layout()  # 못 쓰는 이름이면 여기서 멈춤
    if a.remove:
        remove()
        return 0
    if a.choices:
        data = choices(status_all())
        if a.json:
            print(json.dumps(data, ensure_ascii=False, indent=2))
        else:
            for g in data["groups"]:
                print("[%s]" % g["title"])
                for it in g["features"]:
                    print("  %-12s %-24s %s%s" % (it["name"], it["label"], it["state_label"], " (추천)" if it["recommended"] else ""))
        return 0
    if a.mine:
        return apply(",".join(BY_NAME), a.force)
    if a.apply is not None:
        return apply(a.apply, a.force)
    if a.dry_run is not None:
        return dry_run(a.dry_run)
    return print_status(status_all(), a.json)


if __name__ == "__main__":
    sys.exit(main())
