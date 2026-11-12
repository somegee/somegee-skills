"""기능별 '상태 확인 → 미리보기 → 적용' 공용 틀 (install_*.py 와 setup.py 가 같이 쓴다).

각 기능 스크립트는 plan() 하나를 만든다 — **파일을 하나도 쓰지 않고** "적용하면 이렇게 돼야 한다"를 계산한 것.
  - files : 이 기능이 통째로 가진 파일과 그 내용(mod 파일). 손으로 고친 흔적을 이것으로 본다.
  - checks: 다른 것과 섞인 곳의 조건(keys.json 의 키 하나, 레이아웃 칸 개수, programs.json 항목 하나 등).
evaluate(plan) 이 그걸 지금 디스크와 비교해 상태 하나를 낸다: 최신 / 낡음 / 없음 / 손으로 고친 흔적 / 고칠 문장 못 찾음.

손으로 고친 흔적: 우리가 파일을 쓸 때마다 그 내용의 해시를 APP_HOME/.herdr-custom/installed.json 에 적어 둔다.
설치본이 플러그인판과도 다르고 마지막으로 우리가 쓴 내용과도 다르면 = 누군가 손으로 고친 것(시험 적용 중일 수 있음).
기록이 없는 파일(이 틀 이전에 깔린 것)은 손으로 고쳤는지 알 수 없어 '낡음(설치 기록 없음)'으로 본다.

같은 내용이면 쓰지 않는다(write_if_changed) — mod 파일을 다시 쓰면 앱이 그 mod 를 다시 띄우고,
그 사이 키가 안 닿는 것으로 추정한다(2026-11-12, Ctrl+N 이 한동안 안 먹던 일).
"""
from __future__ import annotations

import difflib
import hashlib
import io
import json
import os
import shutil
import sys
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apphome import APP_HOME  # noqa: E402

STATE_DIR = os.path.join(APP_HOME, ".herdr-custom")
MANIFEST = os.path.join(STATE_DIR, "installed.json")
BACKUP_DIR = os.path.join(STATE_DIR, "backup")
KEYS = os.path.join(APP_HOME, "keys.json")

LATEST, STALE, MISSING, HAND, PATCH, ERROR = "latest", "stale", "missing", "hand-edited", "patch-missing", "error"
LABELS = {
    LATEST: "최신", STALE: "낡음", MISSING: "없음", HAND: "손으로 고친 흔적",
    PATCH: "고칠 문장 못 찾음(앱 업데이트)", ERROR: "오류",
}
EXIT_CODES = {LATEST: 0, STALE: 10, MISSING: 11, HAND: 12, PATCH: 13, ERROR: 14}
NEEDS_APPLY = (STALE, MISSING)  # setup.py --apply 가 이름 없이 고르는 상태


class PatchError(SystemExit):
    """원본 mod 에서 고칠 문장을 못 찾음. 직접 실행 땐 메시지와 함께 끝나고, 상태 확인에선 PATCH 로 잡힌다."""


@dataclass(frozen=True)
class Want:
    path: str
    content: bytes


@dataclass(frozen=True)
class Check:
    label: str  # 맞지 않을 때 보여 줄 말
    ok: bool
    fix: str = ""  # 적용하면 할 일 (미리보기용)


@dataclass(frozen=True)
class Plan:
    feature: str
    files: tuple = ()
    checks: tuple = ()
    present: bool = True  # False 면 '없음'(설치 안 됐거나 --remove 로 뺀 상태)
    error: str = ""
    error_state: str = ERROR


@dataclass(frozen=True)
class Status:
    feature: str
    state: str
    detail: str = ""
    files: tuple = field(default_factory=tuple)  # (상대 경로, same|missing|differs|unrecorded|hand-edited)
    checks: tuple = field(default_factory=tuple)  # (label, ok)

    @property
    def label(self) -> str:
        return LABELS[self.state]

    def line(self) -> str:
        return "%-12s %s%s" % (self.feature, self.label, "(%s)" % self.detail if self.detail else "")

    def as_dict(self) -> dict:
        return {
            "feature": self.feature, "state": self.state, "label": self.label, "detail": self.detail,
            "files": [{"path": p, "state": s} for p, s in self.files],
            "checks": [{"label": c, "ok": ok} for c, ok in self.checks],
        }


# ---- 파일 읽기·쓰기 ----

def read_bytes(path: str) -> Optional[bytes]:
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def rel(path: str) -> str:
    try:
        return os.path.relpath(path, APP_HOME).replace("\\", "/")
    except ValueError:  # Windows 에서 드라이브가 다름
        return path


def load_manifest() -> dict:
    try:
        with io.open(MANIFEST, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def remember(path: str, data: bytes) -> None:
    """우리가 이 파일을 이 내용으로 뒀다고 적는다(다음에 손으로 고친 흔적을 가리려고)."""
    manifest = load_manifest()
    key = rel(path)
    if manifest.get(key) == sha(data):
        return
    os.makedirs(STATE_DIR, exist_ok=True)
    with io.open(MANIFEST, "w", encoding="utf-8") as f:
        f.write(json.dumps({**manifest, key: sha(data)}, ensure_ascii=False, indent=2, sort_keys=True))


def adopt(plan: Plan) -> int:
    """플러그인판과 내용이 같은 설치본을 '우리가 둔 것'으로 기록만 한다(파일은 안 건드림).
    모두 최신이라 아무것도 안 쓰는 PC 에서도 설치 기록이 생겨, 다음부터 손으로 고친 흔적을 가릴 수 있다.
    --apply 경로에서만 부른다(--status·--dry-run 은 아무것도 안 씀)."""
    n = 0
    for w in plan.files:
        if read_bytes(w.path) == w.content:
            remember(w.path, w.content)
            n += 1
    return n


def write_if_changed(path: str, data: bytes) -> bool:
    """내용이 같으면 파일을 건드리지 않는다(시각도 그대로). 바꿨으면 True. 어느 쪽이든 설치 기록은 남긴다."""
    if read_bytes(path) == data:
        remember(path, data)
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    remember(path, data)
    return True


def write_json_if_changed(path: str, data: dict, trailing_newline: bool = False) -> bool:
    """keys.json·programs.json·레이아웃처럼 다른 것과 섞인 파일 — 기록(manifest)은 안 남긴다."""
    text = json.dumps(data, ensure_ascii=False, indent=2) + ("\n" if trailing_newline else "")
    new = text.encode("utf-8")
    if read_bytes(path) == new:
        return False
    with open(path, "wb") as f:
        f.write(new)
    return True


# ---- 상태 판정 ----

def file_state(want: Want, manifest: dict) -> str:
    current = read_bytes(want.path)
    if current is None:
        return "missing"
    if current == want.content:
        return "same"
    recorded = manifest.get(rel(want.path))
    if recorded is None:
        return "unrecorded"
    return "differs" if recorded == sha(current) else "hand-edited"


def evaluate(plan: Plan) -> Status:
    if plan.error:
        return Status(plan.feature, plan.error_state, plan.error)
    manifest = load_manifest()
    files = tuple((rel(w.path), file_state(w, manifest)) for w in plan.files)
    checks = tuple((c.label, c.ok) for c in plan.checks)
    # 손으로 고친 흔적을 '없음'보다 먼저 본다 — --remove 로 레이아웃만 되돌린 복제본을 고쳐 시험 중일 수 있다
    hand = [os.path.basename(p) for p, s in files if s == "hand-edited"]
    if hand:
        return Status(plan.feature, HAND, "플러그인판·지난 설치와 다름: " + ", ".join(hand), files, checks)
    if not plan.present:
        return Status(plan.feature, MISSING, "", files, checks)
    parts = []
    differs = [os.path.basename(p) for p, s in files if s in ("differs", "unrecorded")]
    if differs:
        note = " (설치 기록 없음)" if any(s == "unrecorded" for _, s in files) else ""
        parts.append("플러그인판과 다름: " + ", ".join(differs) + note)
    missing = [os.path.basename(p) for p, s in files if s == "missing"]
    if missing:
        parts.append("파일 없음: " + ", ".join(missing))
    parts += [c.label for c in plan.checks if not c.ok]
    return Status(plan.feature, STALE if parts else LATEST, " · ".join(parts), files, checks)


def safe_plan(feature: str, make: Callable[[], Plan]) -> Plan:
    """plan 계산 중 멈춤(sys.exit)·파일 오류를 상태로 바꾼다 — 상태표가 한 기능 때문에 끊기지 않게."""
    try:
        return make()
    except PatchError as e:
        return Plan(feature, error=str(e.code), error_state=PATCH)
    except SystemExit as e:
        return Plan(feature, error=str(e.code))
    except (OSError, ValueError) as e:
        return Plan(feature, error="%s: %s" % (type(e).__name__, e))


def keys_check(group: str, key: str, value: str, label: str) -> Check:
    try:
        with io.open(KEYS, encoding="utf-8") as f:
            current = json.load(f).get(group, {}).get(key)
    except (OSError, ValueError):
        current = None
    if current == value:
        return Check(label, True)
    if current is None:
        return Check("keys.json %s 없음" % label, False, "keys.json %s.%s = %s" % (group, key, value))
    return Check("keys.json %s = %s" % (label, current), False, "keys.json %s.%s: %s → %s" % (group, key, current, value))


# ---- 미리보기·백업·적용 ----

def changed_lines(old: Optional[bytes], new: bytes) -> str:
    if old is None:
        return "새 파일, %d줄" % len(new.decode("utf-8", "replace").splitlines())
    a = old.decode("utf-8", "replace").splitlines()
    b = new.decode("utf-8", "replace").splitlines()
    plus = minus = 0
    for line in difflib.unified_diff(a, b, lineterm="", n=0):
        if line.startswith("+") and not line.startswith("+++"):
            plus += 1
        elif line.startswith("-") and not line.startswith("---"):
            minus += 1
    return "+%d −%d줄" % (plus, minus) if plus or minus else "줄바꿈·공백만 다름"


def dry_run(plan: Plan) -> Status:
    """적용하면 쓸 파일과 할 일만 보여 준다. 아무것도 쓰지 않는다."""
    st = evaluate(plan)
    print("[%s] %s" % (st.feature, st.line().split(None, 1)[1]))
    if st.state in (PATCH, ERROR):
        print("  적용할 수 없음 — 위 이유를 먼저 해결")
        return st
    if st.state == LATEST:
        print("  할 일 없음")
        return st
    for want, (path, state) in zip(plan.files, st.files):
        if state != "same":
            mark = "  ← 손으로 고친 흔적, --force 없이는 멈춤" if state == "hand-edited" else ""
            print("  쓸 파일: %s (%s)%s" % (path, changed_lines(read_bytes(want.path), want.content), mark))
    for c in plan.checks:
        if not c.ok:
            print("  할 일: %s" % (c.fix or c.label))
    return st


def backup(paths: list) -> str:
    """손으로 고친 파일을 덮기 전에 APP_HOME/.herdr-custom/backup/<시각>/ 아래로 복사한다."""
    dest = os.path.join(BACKUP_DIR, time.strftime("%Y%m%d-%H%M%S"))
    for path in paths:
        r = rel(path)
        target = os.path.join(dest, r if not os.path.isabs(r) else os.path.basename(path))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(path, target)
    return dest


def apply_feature(feature: str, make: Callable[[], Plan], install: Callable[[], None], force: bool = False) -> int:
    """최신이면 아무것도 안 하고, 낡음·없음이면 install() 을 돌린다. 종료 코드를 돌려준다."""
    plan = safe_plan(feature, make)
    st = evaluate(plan)
    if st.state in (LATEST, STALE, MISSING):
        adopt(plan)  # 같은 파일은 기록만 — 최신이어도 설치 기록이 생기게
    if st.state == LATEST:
        print("[%s] 변경 없음" % feature)
        return 0
    if st.state in (PATCH, ERROR):
        print("[%s] %s — 적용 안 함" % (feature, st.line().split(None, 1)[1]))
        return EXIT_CODES[st.state]
    if st.state == HAND:
        hand = [w.path for w, (_, s) in zip(plan.files, st.files) if s == "hand-edited"]
        if not force:
            print("[%s] 멈춤: %s" % (feature, st.detail))
            print("  시험 적용 중인 것일 수 있습니다. 덮으려면 --force (덮기 전에 %s\\<시각>\\ 로 백업)" % BACKUP_DIR)
            return EXIT_CODES[HAND]
        print("[%s] 손으로 고친 파일 백업:" % feature, backup(hand))
    install()
    after = evaluate(safe_plan(feature, make))
    if after.state == LATEST:
        print("[%s] 바뀜 → 최신" % feature)
        return 0
    print("[%s] 적용했지만 아직 %s" % (feature, after.line().split(None, 1)[1]))
    return EXIT_CODES[after.state]


def run_cli(feature: str, make: Callable[[], Plan], install: Callable[[], None], remove: Callable[[], None]) -> None:
    """install_*.py 공용 진입점.
      (옵션 없음)   낡음·없음이면 적용, 최신이면 '변경 없음'      --force  손으로 고친 흔적도 백업 후 덮기
      --status [--json]  이 기능 상태 한 줄 + 종료 코드(0 최신 / 10 낡음 / 11 없음 / 12 손으로 고친 흔적 / 13 고칠 문장 못 찾음 / 14 오류)
      --check            --status 와 같음
      --dry-run          적용하면 쓸 파일·할 일만 보여 줌(아무것도 안 씀)
      --remove           되돌리기
    """
    args = sys.argv[1:]
    if "--remove" in args:
        remove()
        return
    if "--status" in args or "--check" in args:
        st = evaluate(safe_plan(feature, make))
        print(json.dumps(st.as_dict(), ensure_ascii=False) if "--json" in args else st.line())
        sys.exit(EXIT_CODES[st.state])
    if "--dry-run" in args:
        dry_run(safe_plan(feature, make))
        print("  (아무 파일도 쓰지 않았습니다)")
        return
    sys.exit(apply_feature(feature, make, install, force="--force" in args))
