"""herdr 앱 우상단 + 메뉴에 'ccd' 버튼을 넣는다 (claude --dangerously-skip-permissions 로 새 탭).

두 가지를 한다.
  1. ~/.config/herdr-app/programs.json 에 항목 하나(claude-ccd)를 더한다. 다른 항목은 그대로 둔다.
  2. programs.json 의 run 엔 폴더 칸이 없어서, 기본 new-menu mod 를 my-new-menu 로 복제해
     ccd 를 고르면 설치 때 정한 폴더에서 열게 고친다(patchlib — 설치할 때마다 원본에서 다시 고침).
     + 버튼(tabs mod 안)이 my-new-menu 를 열게 하는 건 install_tabs_agent_name.py 가 한다.
폴더를 안 정했거나 다른 기기(원격) 공간이면 지금처럼 그 공간의 폴더에서 열린다.
  python install_ccd_button.py                          # 낡음·없음이면 추가, 최신이면 '변경 없음'
  python install_ccd_button.py --status                 # 상태 한 줄(--json) / --dry-run 미리보기
  python install_ccd_button.py --ccd-folder "<경로>"    # 그 폴더에서 열기 ("" = 지정 해제)
  python install_ccd_button.py --remove                 # 항목·my-new-menu 를 빼고 + 버튼을 기본 메뉴로
"""
import io
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME  # noqa: E402
from patchlib import apply_patches, desired_clone, mod_js, rebuild  # noqa: E402
from featurelib import Check, Plan, Want, run_cli, write_json_if_changed  # noqa: E402
import ccd_folder  # noqa: E402
import install_tabs_agent_name  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEATURE = "ccd-button"
PROGRAMS = os.path.join(APP_HOME, "programs.json")
KEY = "claude-ccd"
ENTRY = {
    "name": "ccd (Claude, 권한 확인 생략)",
    "icon": "icons/claude.svg",
    "tile": "#d97757",
    "run": ["claude", "--dangerously-skip-permissions"],
}
BASE = "new-menu"
CLONE = install_tabs_agent_name.NEW_MENU
NL = "\n"
# KNOWN("new-menu.agents")은 그대로 둔다 — 원본 메뉴와 '설치 확인' 결과 캐시를 같이 쓰려고.
HELPERS = NL.join([
    'const CCD_KEY = "%s";' % KEY,
    'const CCD_FOLDER = "";  // 설치 스크립트가 --ccd-folder 값으로 채운다. "" 이면 공간 폴더',
    "const CCD_PROBE_TIMEOUT_MS = 5000;",
    "// 설치 뒤 폴더가 지워졌을 수 있다 — exec 는 cwd 폴더가 없으면 거절한다(run 은 null 이라 tab.new 실패를 못 앎).",
    "async function ccdFolderOk() {",
    '  const [cmd, args] = window()?.platform === "windows" ? ["cmd", ["/c", "exit"]] : ["true", []];',
    "  try { await exec(cmd, args, { cwd: CCD_FOLDER, timeout: CCD_PROBE_TIMEOUT_MS }); return true; }",
    "  catch { return false; }",
    "}",
    "// ok: 메뉴를 열 때 본 폴더 확인 결과(아직 모르면 undefined → 폴더를 믿고 넘김)",
    "function agentTab(a, space, ok) {",
    "  const opts = { name: a.name, space: space?.id, argv: a.run };",
    "  if (a.key !== CCD_KEY || !CCD_FOLDER || space?.machine) return opts;",
    "  if (ok !== false) return { ...opts, folder: CCD_FOLDER };",
    '  notify({ title: "ccd 폴더가 없음", body: CCD_FOLDER + " — 공간 폴더에서 엽니다. setup.py --ccd-folder 로 다시 지정", level: "warning" });',
    "  return opts;",
    "}",
    "",
])
PATCHES = [
    ('setShared } from "herdr";', 'setShared, exec, notify } from "herdr";'),
    ('const KNOWN = "new-menu.agents";' + NL, 'const KNOWN = "new-menu.agents";' + NL + HELPERS),
    # 메뉴를 열 때 폴더를 미리 확인 (이 기기 공간일 때만)
    ("    this.handle = cx.focus_handle();" + NL,
     "    if (CCD_FOLDER && !machine) cx.spawn(async () => { this.ccdOk = await ccdFolderOk(); });" + NL
     + "    this.handle = cx.focus_handle();" + NL),
    # 숫자키 1~9 로 고를 때
    ('run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });',
     'run("tab.new", agentTab(agent, space, this.ccdOk));'),
    # 클릭할 때
    ('() => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), ',
     '() => run("tab.new", agentTab(a, space, this.ccdOk)), '),
]


def load():
    if not os.path.exists(PROGRAMS):
        return {}
    with io.open(PROGRAMS, encoding="utf-8") as f:
        return json.load(f)


def save(data):
    if os.path.exists(PROGRAMS) and not os.path.exists(PROGRAMS + ".bak-ccd"):
        shutil.copy2(PROGRAMS, PROGRAMS + ".bak-ccd")
    write_json_if_changed(PROGRAMS, data, trailing_newline=True)


def build(src, folder):
    return ccd_folder.set_in_source(apply_patches(src, PATCHES, BASE), "CCD_FOLDER", folder)


def plan(folder_arg=None):
    folder = ccd_folder.resolve(folder_arg, quiet=True)
    has_entry = load().get("programs", {}).get(KEY)
    want = Want(mod_js(CLONE), desired_clone(BASE, CLONE, lambda src: build(src, folder)))
    return Plan(FEATURE, files=(want,),
                checks=(Check("programs.json ccd 항목 " + ("다름" if has_entry else "없음"), has_entry == ENTRY,
                              "programs.json 에 claude-ccd 항목 넣기"),),
                present=os.path.exists(mod_js(CLONE)) or has_entry is not None)


def add_entry():
    data = load()
    programs = data.get("programs", {})
    if programs.get(KEY) == ENTRY:
        print("이미 있음 — + 메뉴 ccd 버튼")
        return
    save({**data, "programs": {**programs, KEY: ENTRY}})
    print("추가 완료: + 메뉴 ccd 버튼 (", PROGRAMS, ")")


def install(folder_arg=None):
    folder = ccd_folder.resolve(folder_arg)
    add_entry()
    changed = rebuild(BASE, CLONE, lambda src: build(src, folder))
    print("my-new-menu", "고침" if changed else "변경 없음", "/ ccd 폴더:", ccd_folder.describe(folder))
    install_tabs_agent_name.refresh()


def remove():
    data = load()
    programs = data.get("programs", {})
    if KEY in programs:
        save({**data, "programs": {k: v for k, v in programs.items() if k != KEY}})
        print("뺌: + 메뉴 ccd 버튼")
    else:
        print("없음 — + 메뉴 ccd 버튼")
    clone_dir = os.path.dirname(mod_js(CLONE))
    if os.path.exists(clone_dir):
        shutil.rmtree(clone_dir, ignore_errors=True)
        print("지움:" if not os.path.exists(clone_dir) else "!! 못 지움(앱이 잡고 있는 듯, 손으로 지우세요):", clone_dir)
    install_tabs_agent_name.refresh()  # my-tabs 의 + 버튼을 다시 기본 new-menu 로


if __name__ == "__main__":
    FOLDER_ARG = ccd_folder.parse_arg(sys.argv[1:])
    run_cli(FEATURE, lambda: plan(FOLDER_ARG), lambda: install(FOLDER_ARG), remove)
