"""ccd 새 탭(Ctrl+N·+ 메뉴 ccd)을 열 폴더 정하기 — install_ccd_key·install_ccd_button·setup 이 같이 쓴다.

정하는 순서 (resolve):
  1. --ccd-folder "<경로>" 를 줬으면 그 값 ("" = 지정 해제 → 공간 폴더)
  2. 없으면 이미 설치된 값 유지 (ccd-key → my-new-menu 설치본의 `const (CCD_)FOLDER = ...` 줄)
  3. 설치본에 그 줄이 없으면(첫 설치·예전 판) PowerShell 프로필의 ccd 함수에서 Set-Location "<경로>" 를 찾아 씀
  4. 그래도 없으면 "" = 공간 폴더(예전과 같은 동작)
ccd 함수·PowerShell 프로필은 대부분의 PC 에 없다고 보고 짠다 — 못 찾거나 못 읽으면 조용히 건너뛴다.
"""
from __future__ import annotations

import functools
import io
import json
import locale
import os
import re
import shutil
import subprocess
import sys
from typing import Optional, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apphome import APP_HOME  # noqa: E402
from featurelib import PatchError  # noqa: E402

OPTION = "--ccd-folder"
KEY_MOD = "ccd-key"
MENU_MOD = "my-new-menu"
PROFILE_TIMEOUT_SECONDS = 15
# 설치본 main.js 에서 폴더 값을 읽는 줄 — ccd-key 는 FOLDER, my-new-menu 는 CCD_FOLDER
INSTALLED_RE = re.compile(r'^const (?:CCD_)?FOLDER = ("(?:[^"\\]|\\.)*");', re.M)
CCD_FUNC_RE = re.compile(r"function\s+ccd\b[^{]*\{", re.I)
# Set-Location 바로 뒤의 따옴표 경로만 읽는다(-Path·변수·cd·Push-Location 은 못 읽은 것으로 보고 건너뜀)
SET_LOCATION_RE = re.compile(r"""Set-Location\s+(["'])([^"'$`]+)\1""", re.I)


def mod_main(name: str) -> str:
    return os.path.join(APP_HOME, "mods", name, "main.js")


def parse_arg(argv: Sequence[str]) -> Optional[str]:
    """--ccd-folder <값> / --ccd-folder=<값>. 안 줬으면 None."""
    for i, a in enumerate(argv):
        if a.startswith(OPTION + "="):
            return clean(a[len(OPTION) + 1:])
        if a == OPTION:
            if i + 1 >= len(argv):
                sys.exit(OPTION + ' 뒤에 폴더 경로가 없음 — 지정 해제는 --ccd-folder ""')
            return clean(argv[i + 1])
    return None


def clean(path: str) -> str:
    path = path.strip().strip('"').strip("'").strip()
    return os.path.expandvars(os.path.expanduser(path)) if path else ""


def js_literal(folder: str) -> str:
    """JS 문자열로 — 백슬래시·따옴표 이스케이프(C:\\Users\\...)."""
    return json.dumps(folder, ensure_ascii=False)


def read_installed(path: str) -> Optional[str]:
    """설치본 main.js 의 폴더 값. 파일이나 그 줄이 없으면 None ("" 은 '지정 해제'로 유지할 값)."""
    try:
        with io.open(path, encoding="utf-8") as f:
            m = INSTALLED_RE.search(f.read())
    except OSError:
        return None
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


def installed_values() -> dict[str, Optional[str]]:
    return {KEY_MOD: read_installed(mod_main(KEY_MOD)), MENU_MOD: read_installed(mod_main(MENU_MOD))}


def ccd_from_text(text: str) -> Optional[str]:
    """프로필 글에서 function ccd { ... Set-Location "<경로>" ... } 의 경로. 형식이 다르면 None."""
    m = CCD_FUNC_RE.search(text)
    if not m:
        return None
    depth, end = 1, m.end()
    while end < len(text) and depth:
        depth += {"{": 1, "}": -1}.get(text[end], 0)
        end += 1
    loc = SET_LOCATION_RE.search(text[m.end():end])
    return loc.group(2).strip() if loc else None


def profile_paths() -> list[str]:
    """PowerShell 이 알려 주는 프로필 위치(OneDrive 로 옮긴 문서 폴더도 맞게). 셸이 없거나 실패하면 빈 목록."""
    script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $PROFILE.CurrentUserAllHosts; $PROFILE"
    paths: list[str] = []
    for shell in ("powershell", "pwsh"):
        exe = shutil.which(shell)
        if not exe:
            continue
        try:
            r = subprocess.run([exe, "-NoProfile", "-Command", script], capture_output=True, timeout=PROFILE_TIMEOUT_SECONDS)
        except (OSError, subprocess.SubprocessError):
            continue
        for line in r.stdout.decode("utf-8", "replace").splitlines():
            line = line.strip()
            if line and line not in paths:
                paths.append(line)
    return paths


def read_text(path: str) -> Optional[str]:
    for enc in ("utf-8-sig", locale.getpreferredencoding(False)):
        try:
            with io.open(path, encoding=enc) as f:
                return f.read()
        except (OSError, UnicodeDecodeError, LookupError):
            continue
    return None


@functools.lru_cache(maxsize=None)  # 상태 확인·적용이 여러 번 물어도 PowerShell 은 한 번만
def from_profile() -> Optional[str]:
    for path in profile_paths():
        text = read_text(path)
        found = ccd_from_text(text) if text else None
        if found:
            print("PowerShell 프로필의 ccd 함수에서 폴더를 찾음:", found, "(" + path + ")", file=sys.stderr)
            return found
    return None


def resolve(arg: Optional[str], quiet: bool = False) -> str:
    """위 순서대로 정하고, 폴더가 실제로 있는지·claude 가 PATH 에 있는지 검사(경고만, quiet 면 경고도 안 냄)."""
    if arg is not None:
        folder = arg
    else:
        vals = installed_values()
        folder = next((v for v in (vals[KEY_MOD], vals[MENU_MOD]) if v is not None), None)
        if folder is None:
            folder = from_profile() or ""
    if folder and not os.path.isdir(folder):
        if not quiet:
            print("!! 경고: ccd 폴더가 없음 →", folder, "— 공간 폴더로 둡니다(없는 폴더로는 탭이 안 열림). 다시 지정: --ccd-folder \"<경로>\"")
        folder = ""
    if not quiet and not shutil.which("claude"):
        print("!! 경고: claude 가 PATH 에 없음 — + 메뉴 ccd 는 'not installed' 로 흐리게, Ctrl+N 은 오류 알림이 뜹니다.")
    return folder


def describe(folder: Optional[str]) -> str:
    if folder is None:
        return "모름(설치본에 폴더 줄 없음)"
    if not folder:
        return "공간 폴더(미지정)"
    return folder if os.path.isdir(folder) else folder + " (없음! 다시 지정 필요)"


def set_in_source(src: str, name: str, folder: str) -> str:
    """mod 코드의 `const <name> = "";` 한 줄을 폴더 값으로 채운다. 그 줄이 정확히 1번 없으면 멈춘다."""
    line = 'const %s = "";' % name
    if src.count(line) != 1:
        raise PatchError("mod 코드에서 '%s' 줄을 못 찾음 — 설치 스크립트를 확인" % line)
    return src.replace(line, "const %s = %s;" % (name, js_literal(folder)))
