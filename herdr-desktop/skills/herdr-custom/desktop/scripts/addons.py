"""각자 덧붙인 기능(addon) — 복제본(my-tabs·my-spaces·my-agents)을 원본에서 다시 만들 때도 지켜지게.

복제본은 설치할 때마다 기본 mod 에서 처음부터 다시 만든다(patchlib). 그래서 플러그인 밖에서 복제본에
버튼 하나를 더 넣어 두면(예: 자기 서버와 이어지는 팝업), 다음 설치·업데이트 때 말없이 사라졌다.
그런 덧붙이기는 APP_HOME/.herdr-custom/addons/<이름>.json 에 적어 두면 다시 만들 때마다 같이 넣는다.
이 폴더는 플러그인이 만들거나 지우지 않는다(되돌리기 --remove 도 안 건드림) — 각자의 것이다.

파일 꼴 (둘 다 써도 되고 하나만 써도 된다):
{
  "tabs_button": {"mod": "<여는 mod>", "label": "<버튼 글자>", "icon": "mods/<mod>/<아이콘>.svg", "width": 540, "height": 660},
  "patches": {"my-tabs": [["<원본에 정확히 한 번 나오는 문장>", "<바꿀 문장>"], ...], "my-spaces": [...], "my-agents": [...]}
}
- tabs_button: 상단 탭 바 오른쪽 Files 왼쪽에 버튼을 넣고, 누르면 그 mod 를 dialog 로 연다. 그 mod(mods/<mod>/main.js)가 있을 때만.
- patches: 플러그인 패치를 다 건 뒤, 자기 이름 바꾸기(rename_self) **전** 내용 기준으로 차례로 건다(patchlib.apply_patches 와 같은 규칙).
  그래서 문장 속 경로는 기본 mod 이름(mods/tabs/…)으로 적는다 — 설치된 my-tabs/main.js 에서 복사하면 mods/my-tabs/ 라 안 맞는다.
  줄바꿈은 \n 기준(CRLF 문장은 안 맞음). 바꿀 문장을 "" 로 두면 그 문장을 지운다.
- 한 덧붙이기가 못 걸리면(문장 못 찾음·형식 오류) 그것만 빼고 나머지는 그대로 만든다 — 결과에 '못 넣음'으로 보인다.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apphome import APP_HOME  # noqa: E402
from featurelib import STATE_DIR, PatchError  # noqa: E402

ADDON_DIR = os.path.join(STATE_DIR, "addons")
CLONES = ("my-tabs", "my-spaces", "my-agents")
NAME_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,40}")
MOD_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,40}")
ICON_RE = re.compile(r"mods/[a-z0-9][a-z0-9-]{0,40}/[A-Za-z0-9._-]{1,60}\.svg")
MAX_LABEL_CHARS = 20
TOP_KEYS = ("tabs_button", "patches")
BASE_MODS = ("tabs", "spaces", "agents")  # 이름 바꾸기에 걸려 복제본을 가리키게 되므로 tabs_button.mod 로 못 씀
MIN_SIZE, MAX_SIZE = 200, 1600

# my-tabs 원본(+ 플러그인 패치) 문장 — install_tabs_agent_name.py 의 버튼 자리와 같아야 한다(테스트가 확인)
TABS_RENDER_ANCHOR = "    return h_flex().size_full().min_w(0).px(10)"
TABS_FILES_ANCHOR = '      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))'


def mod_exists(name: str) -> bool:
    return os.path.exists(os.path.join(APP_HOME, "mods", name, "main.js"))


def load() -> list:
    """(이름, 내용 또는 None, 오류 문구) 목록 — 이름 순."""
    if not os.path.isdir(ADDON_DIR):
        return []
    out = []
    for fn in sorted(os.listdir(ADDON_DIR)):
        if not fn.endswith(".json"):
            continue
        name = fn[:-5]
        if not NAME_RE.fullmatch(name):
            out.append((name, None, "파일 이름은 영문 소문자·숫자·- 만"))
            continue
        try:
            with io.open(os.path.join(ADDON_DIR, fn), encoding="utf-8-sig") as f:
                data = json.load(f)
        except (OSError, ValueError) as e:
            out.append((name, None, "JSON 을 못 읽음: %s" % e))
            continue
        if not isinstance(data, dict):
            out.append((name, None, "JSON 객체가 아님"))
            continue
        err = validate(data)
        out.append((name, None, err) if err else (name, data, ""))
    return out


def validate(data: dict) -> str:
    """형식만 본다(문장이 원본에 있는지는 걸 때 본다). 문제가 있으면 그 문구, 없으면 "" — 틀린 것을 조용히 건너뛰지 않게."""
    unknown = [k for k in data if k not in TOP_KEYS]
    if unknown:
        return "모르는 항목: %s (쓸 수 있는 것: %s)" % (", ".join(unknown), ", ".join(TOP_KEYS))
    if not any(k in data for k in TOP_KEYS):
        return "tabs_button 이나 patches 가 없음"
    if "tabs_button" in data:
        try:
            tabs_button_patches("x", data["tabs_button"])
        except PatchError as e:
            return str(e.code)
    if "patches" in data:
        raw = data["patches"]
        if not isinstance(raw, dict) or not raw:
            return "patches 는 {복제본 이름: [[원래 문장, 바꿀 문장], ...]}"
        bad = [c for c in raw if c not in CLONES]
        if bad:
            return "patches 의 복제본 이름이 틀림: %s (쓸 수 있는 것: %s)" % (", ".join(bad), ", ".join(CLONES))
        for clone, items in raw.items():
            if not isinstance(items, list) or not items or not all(
                    isinstance(p, list) and len(p) == 2 and isinstance(p[0], str) and p[0] and isinstance(p[1], str)
                    for p in items):
                return "patches.%s 는 [[원래 문장, 바꿀 문장], ...] (원래 문장은 비울 수 없음)" % clone
    return ""


def tabs_button_patches(name: str, spec) -> list:
    """tabs_button → my-tabs 패치 두 개(버튼 만들기 + Files 왼쪽에 넣기). 형식이 틀리면 PatchError."""
    if not isinstance(spec, dict):
        raise PatchError("tabs_button 은 객체여야 함")
    mod, label, icon = spec.get("mod"), spec.get("label"), spec.get("icon")
    width, height = spec.get("width", 600), spec.get("height", 480)
    if not isinstance(mod, str) or not MOD_RE.fullmatch(mod) or mod in BASE_MODS:
        raise PatchError("tabs_button.mod 는 mod 폴더 이름(영문 소문자·숫자·-, 기본 %s 는 안 됨)" % "·".join(BASE_MODS))
    if not isinstance(label, str) or not label.strip() or len(label) > MAX_LABEL_CHARS:
        raise PatchError("tabs_button.label 은 1~%d자" % MAX_LABEL_CHARS)
    if icon is not None and (not isinstance(icon, str) or not ICON_RE.fullmatch(icon)):
        raise PatchError("tabs_button.icon 은 mods/<폴더>/<이름>.svg")
    for v in (width, height):
        if not isinstance(v, int) or isinstance(v, bool) or not MIN_SIZE <= v <= MAX_SIZE:
            raise PatchError("tabs_button.width·height 는 %d~%d 정수" % (MIN_SIZE, MAX_SIZE))
    var = "addonButton_" + name.replace("-", "_")
    icon_js = ".child(svg(%s).size(14))" % json.dumps(icon) if icon else ""
    render = "\n".join([
        "    // [herdr-custom addon %s] .herdr-custom/addons/%s.json 의 tabs_button" % (name, name),
        "    const %s = () => h_flex().id(%s).h(26).px(8).gap(5).flex_none().items_center().rounded(6)" % (var, json.dumps("addon-" + name)),
        "      .text_size(12).bg(t.chrome).text_color(t.muted)",
        '      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)',
        "      .on_click(() => openOverlay({ mod: %s, kind: \"dialog\", width: %d, height: %d }))" % (json.dumps(mod), width, height),
        "      %s.child(%s);" % (icon_js, json.dumps(label, ensure_ascii=False)),
        "",
    ])
    return [(TABS_RENDER_ANCHOR, render + TABS_RENDER_ANCHOR),
            (TABS_FILES_ANCHOR, "      .child(%s())\n" % var + TABS_FILES_ANCHOR)]


def icon_exists(icon: str) -> bool:
    return os.path.exists(os.path.join(APP_HOME, *icon.split("/")))


def patches_for(name: str, data: dict, clone: str) -> list:
    """이 덧붙이기가 이 복제본에 거는 패치(형식은 load 에서 이미 봄). 깔린 게 없어 못 걸면 PatchError."""
    out = []
    if clone == "my-tabs" and "tabs_button" in data:
        spec = data["tabs_button"]
        if not mod_exists(spec["mod"]):
            raise PatchError("여는 mod(%s)가 없음 — 그 mod 를 깔면 버튼이 들어감" % spec["mod"])
        if spec.get("icon") and not icon_exists(spec["icon"]):
            raise PatchError("아이콘 파일이 없음: %s" % spec["icon"])
        out += tabs_button_patches(name, spec)
    return out + [tuple(p) for p in data.get("patches", {}).get(clone, [])]


def touches(data: dict, clone: str) -> bool:
    return (clone == "my-tabs" and "tabs_button" in data) or (
        isinstance(data.get("patches"), dict) and clone in data["patches"])


def apply(src: str, clone: str) -> tuple:
    """플러그인 패치까지 건 src 에 덧붙이기를 건다 → (새 src, [(이름, 문제 또는 "")]). 못 거는 것은 빼고 계속."""
    from patchlib import apply_patches  # patchlib 이 이 모듈을 부르므로 여기서
    report = []
    for name, data, _err in load():
        if data is None or not touches(data, clone):  # 못 읽은 파일은 addons_lines 가 한 번만 알린다
            continue
        try:
            src = apply_patches(src, patches_for(name, data, clone), "%s(덧붙이기 %s)" % (clone, name))
            report.append((name, ""))
        except PatchError as e:
            report.append((name, str(e.code if e.code is not None else e)))
    return src, report


def summary(clone: str) -> str:
    """상태·설치 결과에 붙일 한 줄 — 덧붙이기가 없으면 빈 글."""
    from patchlib import desired_clone_report  # 실제로 만들어 보고 어떤 게 걸렸는지 본다
    report = desired_clone_report(clone)
    if not report:
        return ""
    return "덧붙이기 " + ", ".join(n if not why else "%s(못 넣음: %s)" % (n, why) for n, why in report)


def status() -> list:
    """setup.py 상태표·--json 용 — [{clone, name, problem}] (problem 이 ""면 들어감). 못 읽은 파일은 clone 이 null."""
    from patchlib import desired_clone_report
    rows = [{"clone": None, "name": n, "problem": err} for n, data, err in load() if data is None]
    for clone in CLONES:
        rows += [{"clone": clone, "name": n, "problem": why} for n, why in desired_clone_report(clone)]
    return rows
