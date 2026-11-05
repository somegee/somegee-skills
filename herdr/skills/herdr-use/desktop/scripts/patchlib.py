"""기본 mod 를 복제본(my-*)으로 고쳐 쓰는 공용 도구 (my-agents·my-tabs·my-spaces 가 같이 쓴다).

기본 mod(mods/<base>/main.js)는 앱을 켤 때마다 원본으로 되돌아간다. 그래서 설치할 때마다
**원본에서 처음부터 다시 고쳐** 복제본(mods/<clone>/main.js)을 덮어쓴다.
- 고친 판을 또 고치는 '덧대기'가 없어서, 패치 문장은 늘 원본 문장 기준이다.
- 복제본을 손으로 고친 내용은 다음 설치 때 사라진다 → 고칠 땐 설치 스크립트를 고친다.
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import time
from typing import Callable, Sequence, Union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME, app_exe  # noqa: E402

CLONE_WAIT_TRIES = 20  # mod.clone 뒤 복제 폴더가 생길 때까지 확인하는 횟수
CLONE_WAIT_SECONDS = 0.25  # 그 간격

Patch = tuple[str, str]
# 항목이 리스트면 대안들(앱 판마다 원본 문장이 다를 때) — 그중 정확히 1번 나오는 하나에만 적용한다
PatchEntry = Union[Patch, list[Patch]]


def mod_js(name: str) -> str:
    return os.path.join(APP_HOME, "mods", name, "main.js")


def apply_patches(src: str, patches: Sequence[PatchEntry], label: str) -> str:
    """원본 src 에 패치를 차례로 적용한다. 고칠 문장이 없거나 여러 번 나오면 멈춘다(엉뚱하게 고친 채 남지 않게)."""
    for entry in patches:
        alts = entry if isinstance(entry, list) else [entry]
        hits = [(old, new) for old, new in alts if src.count(old) == 1]
        if len(hits) != 1:
            sys.exit("고칠 문장을 못 찾음(기본 %s mod 가 바뀐 듯): %s" % (label, alts[0][0].strip()[:80]))
        old, new = hits[0]
        src = src.replace(old, new)
    return src


def ensure_clone(base: str, clone: str) -> None:
    """복제 폴더가 없으면 앱에 mod.clone 을 시킨다(아이콘·타입 파일까지 같이 복사됨)."""
    if os.path.exists(mod_js(clone)):
        return
    subprocess.run([app_exe(), "do", "mod.clone", json.dumps({"name": base, "as": clone})], check=True)
    for _ in range(CLONE_WAIT_TRIES):
        if os.path.exists(mod_js(clone)):
            return
        time.sleep(CLONE_WAIT_SECONDS)
    sys.exit("mod.clone 뒤에도 " + mod_js(clone) + " 가 안 생김 — 앱이 켜져 있는지 확인")


def rename_self(src: str, base: str, clone: str) -> str:
    """mod.clone 이 하던 대로 자기 이름 참조를 복제본 이름으로 바꾼다.
    (예: tabs 의 아이콘 경로 "mods/tabs/win-min.svg", agents 의 팝업 openOverlay({ mod: "agents" }))
    안 바꾸면 복제본이 원본 mod 의 파일·창을 가리킨다."""
    return src.replace("mods/%s/" % base, "mods/%s/" % clone).replace('mod: "%s"' % base, 'mod: "%s"' % clone)


def rebuild(base: str, clone: str, build: Callable[[str], str]) -> bool:
    """원본 base 를 build 로 고쳐 clone 에 쓴다. 바뀌었으면 True. 줄바꿈은 원본(앱은 CRLF)을 따른다."""
    ensure_clone(base, clone)
    with io.open(mod_js(base), encoding="utf-8", newline="") as f:
        raw = f.read()
    crlf = "\r\n" in raw
    new = rename_self(build(raw.replace("\r\n", "\n")), base, clone)
    if crlf:
        new = new.replace("\n", "\r\n")
    with io.open(mod_js(clone), encoding="utf-8", newline="") as f:
        current = f.read()
    if new == current:
        return False
    with io.open(mod_js(clone), "w", encoding="utf-8", newline="") as f:
        f.write(new)
    return True
