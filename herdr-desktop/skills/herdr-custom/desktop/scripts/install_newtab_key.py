"""herdr 앱: Ctrl+N → 앱 자체 기능 tab.new (지금 공간에 새 터미널 탭). mod 없이 keys.json 한 줄만.

예전 ccd-key(Ctrl+N → ccd 새 Claude 탭, mod 가 키를 받음)는 키가 자주 안 먹어서 0.9.0 에서 뺐다.
이 스크립트가 남은 ccd-key(단축키·레이아웃 칸·mods/ccd-key 폴더)를 치우고 Ctrl+N 을 tab.new 로 건다.
  python install_newtab_key.py            # 낡음·없음이면 적용, 최신이면 '변경 없음'
  python install_newtab_key.py --status   # 상태 한 줄(--json) / --dry-run 미리보기
  python install_newtab_key.py --remove   # Ctrl+N 을 비움 (앱 기본엔 Ctrl+N 이 없다 — 새 탭 기본키는 Ctrl+Shift+T)
Ctrl+N 은 global 묶음이라 터미널 안에서도 앱이 먼저 받는다 → 프로그램의 Ctrl+N(Claude 입력 기록 아래로 등)은 못 쓴다.
"""
import io
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME, LAYOUTS, SHIPPED, load, mod_blocks, save  # noqa: E402
from featurelib import KEYS, Check, Plan, keys_check, run_cli, write_json_if_changed  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEATURE = "newtab-key"
KEY = "ctrl-n"
ACTION = "tab.new"
OLD_MOD = "ccd-key"
OLD_ACTION = OLD_MOD + ".new"
OLD_DIR = os.path.join(APP_HOME, "mods", OLD_MOD)
BACKUP = KEYS + ".bak-newtabkey"


def current_key():
    try:
        with io.open(KEYS, encoding="utf-8") as f:
            return json.load(f).get("global", {}).get(KEY)
    except (OSError, ValueError):
        return None


def own_layouts():
    if not os.path.isdir(LAYOUTS):
        return []
    names = [os.path.splitext(n)[0] for n in sorted(os.listdir(LAYOUTS)) if n.endswith(".json")]
    return [n for n in names if n not in SHIPPED]


def old_leftovers():
    """남은 ccd-key 흔적 — 레이아웃 칸이 있는 레이아웃 이름들, mod 폴더가 있는지."""
    layouts = [n for n in own_layouts() if mod_blocks(load(n), OLD_MOD)]
    return layouts, os.path.isdir(OLD_DIR)


def old_check():
    layouts, has_dir = old_leftovers()
    if not layouts and not has_dir:
        return Check("예전 ccd-key 없음", True)
    what = (["레이아웃 칸: " + ", ".join(layouts)] if layouts else []) + (["mods/ccd-key 폴더"] if has_dir else [])
    return Check("예전 ccd-key 남음(%s)" % ", ".join(what), False, "예전 ccd-key 치우기: " + ", ".join(what))


def plan():
    layouts, has_dir = old_leftovers()
    present = current_key() in (ACTION, OLD_ACTION) or bool(layouts) or has_dir
    return Plan(FEATURE, checks=(keys_check("global", KEY, ACTION, "Ctrl+N = 새 터미널(tab.new)"), old_check()),
                present=present)


def set_key(value):
    """Ctrl+N 을 value 로(None = 비움). 우리가 건 값(tab.new·ccd-key.new)이 아닌 다른 동작이면 멈춘다."""
    with io.open(KEYS, encoding="utf-8") as f:
        keys = json.load(f)
    glob = keys.setdefault("global", {})
    now = glob.get(KEY)
    if now not in (None, ACTION, OLD_ACTION):
        sys.exit("Ctrl+N 이 이미 다른 동작(%s)에 걸려 있음 — keys.json 을 보고 정한 뒤 다시 실행" % now)
    if now == value:
        return
    if not os.path.exists(BACKUP):
        shutil.copy2(KEYS, BACKUP)
    if value is None:
        glob.pop(KEY, None)
    else:
        glob[KEY] = value
    write_json_if_changed(KEYS, keys)
    print("keys.json: Ctrl+N =", value or "(비움)")


def clear_old():
    for name in own_layouts():
        layout = load(name)
        blocks = mod_blocks(layout, OLD_MOD)
        for lst, child in blocks:
            lst.remove(child)
        if blocks:
            save(name, layout)
            print("레이아웃에서 예전 ccd-key 칸 뺌:", name)
    if os.path.isdir(OLD_DIR):
        shutil.rmtree(OLD_DIR, ignore_errors=True)
        print("mods/ccd-key 지움")


def install():
    set_key(ACTION)  # 키를 먼저 옮긴다 — ccd-key.new 를 가리킨 채 칸을 빼면 앱이 칸을 다시 넣는다
    clear_old()
    print("Ctrl+N = 새 터미널 탭(앱 자체 tab.new)")


def remove():
    set_key(None)
    clear_old()
    print("되돌림: Ctrl+N 비움 (새 탭은 Ctrl+Shift+T)")


if __name__ == "__main__":
    run_cli(FEATURE, plan, install, remove)
