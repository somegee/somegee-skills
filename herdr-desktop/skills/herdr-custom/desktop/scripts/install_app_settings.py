"""herdr 앱: 내 앱 설정(settings.json) — 어두운 화면 + 사용 통계 보내기 끔.

mod·레이아웃은 안 건드리고 settings.json 의 아래 항목만 맞춘다(다른 항목은 그대로).
  python install_app_settings.py            # 낡음·없음이면 적용, 최신이면 '변경 없음'
  python install_app_settings.py --status   # 상태 한 줄(--json) / --dry-run 미리보기
  python install_app_settings.py --remove   # 적용 전 값으로 되돌림(백업에 없던 항목은 뺌 = 앱 기본값)
"""
import io
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apphome import APP_HOME  # noqa: E402
from featurelib import Check, Plan, run_cli, write_json_if_changed  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEATURE = "app-settings"
SETTINGS = os.path.join(APP_HOME, "settings.json")
BACKUP = SETTINGS + ".bak-appsettings"
# 항목 → (값, 보여 줄 이름)
WANTED = {
    "appearance": ("dark", "어두운 화면"),
    "telemetry": (False, "사용 통계 안 보냄"),
}


def read(path):
    try:
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def checks(current):
    out = []
    for key, (value, label) in WANTED.items():
        now = current.get(key)
        if now == value:
            out.append(Check(label, True))
        else:
            out.append(Check("settings.json %s = %s" % (key, json.dumps(now)), False,
                             "settings.json %s: %s → %s" % (key, json.dumps(now), json.dumps(value))))
    return tuple(out)


def plan():
    current = read(SETTINGS)
    present = any(current.get(k) == v for k, (v, _l) in WANTED.items())
    return Plan(FEATURE, checks=checks(current), present=present)


def install():
    current = read(SETTINGS)
    if os.path.exists(SETTINGS) and not os.path.exists(BACKUP):
        shutil.copy2(SETTINGS, BACKUP)
    updated = {**current, **{k: v for k, (v, _l) in WANTED.items()}}
    if write_json_if_changed(SETTINGS, updated):
        print("settings.json:", ", ".join("%s=%s" % (k, json.dumps(v)) for k, (v, _l) in WANTED.items()))
    print("앱 설정 맞춤 (화면 반영이 안 되면 앱을 다시 켜기)")


def remove():
    current = read(SETTINGS)
    before = read(BACKUP)
    restored = {k: v for k, v in current.items() if k not in WANTED}
    restored.update({k: before[k] for k in WANTED if k in before})
    write_json_if_changed(SETTINGS, restored)
    print("되돌림: settings.json 의 %s 를 적용 전 값으로" % ", ".join(WANTED))


if __name__ == "__main__":
    run_cli(FEATURE, plan, install, remove)
