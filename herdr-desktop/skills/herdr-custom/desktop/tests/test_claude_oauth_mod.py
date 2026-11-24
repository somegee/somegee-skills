"""claude-oauth — 설치·설정 파일·제거, my-tabs OAuth 버튼 패치, mod 의 순수 함수(설정 검사·명령 인자·응답 해석·PowerShell 인코딩).

  python -m pytest herdr-desktop/skills/herdr-custom/desktop/tests/test_claude_oauth_mod.py
"""
import base64
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)
SCRIPTS = os.path.join(DESKTOP, "scripts")
MAIN_JS = os.path.join(DESKTOP, "assets", "claude-oauth", "main.js")
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, HERE)
import featurelib as fl  # noqa: E402
import install_tabs_agent_name as tabs  # noqa: E402
from patchlib import apply_patches, ensure_imports  # noqa: E402
from test_feature_status import home, run, tree  # noqa: E402,F401  같은 가짜 앱 폴더
from test_resume_all import FAKE_TABS  # noqa: E402

NODE = shutil.which("node")
CMD = "docker exec -i app python -m oauth.cli"


def read_main() -> str:
    with open(MAIN_JS, encoding="utf-8") as f:
        return f.read()


# ---- 설치·설정·제거 ----

def test_install_with_config_then_remove(home):
    code, out = run(home, "install_claude_oauth.py", "--status")
    assert code == fl.EXIT_CODES[fl.MISSING], out
    code, out = run(home, "install_claude_oauth.py", "--on", "srv", "--command", CMD)
    assert code == 0 and "바뀜 → 최신" in out, out
    mod = home / "mods" / "claude-oauth"
    assert sorted(os.listdir(mod)) == ["key.svg", "main.js", "mod.json"]
    cfg = json.loads((home / ".herdr-custom" / "claude-oauth.json").read_text(encoding="utf-8"))
    assert cfg == {"on": "srv", "command": CMD.split()}

    before = tree(home)
    code, out = run(home, "install_claude_oauth.py")
    assert code == 0 and "변경 없음" in out, out
    assert tree(home) == before

    code, out = run(home, "install_claude_oauth.py", "--remove")
    assert code == 0, out
    assert not mod.exists()
    assert (home / ".herdr-custom" / "claude-oauth.json").exists()  # 설정은 남김


def test_install_without_config_warns(home):
    code, out = run(home, "install_claude_oauth.py")
    assert code == 0 and "설정 파일이 없음" in out, out


def test_config_can_change_while_mod_is_latest(home):
    run(home, "install_claude_oauth.py", "--on", "srv", "--command", CMD)
    code, out = run(home, "install_claude_oauth.py", "--on", "other", "--command", "echo hi")
    assert code == 0 and "변경 없음" in out, out
    cfg = json.loads((home / ".herdr-custom" / "claude-oauth.json").read_text(encoding="utf-8"))
    assert cfg == {"on": "other", "command": ["echo", "hi"]}


@pytest.mark.parametrize("args", [
    ["--on", "srv"],                                   # 하나만
    ["--on", "bad name", "--command", CMD],             # 기기 이름에 빈칸
    ["--on", "srv", "--command", "rm -rf ~; echo"],     # 셸 글자
    ["--on", "srv", "--command", ""],
])
def test_bad_config_args_stop(home, args):
    code, out = run(home, "install_claude_oauth.py", *args)
    assert code != 0, out
    assert not (home / ".herdr-custom" / "claude-oauth.json").exists()


@pytest.mark.parametrize("mode", ["--dry-run", "--status", "--remove"])
def test_config_args_refused_outside_install(home, mode):
    code, out = run(home, "install_claude_oauth.py", mode, "--on", "srv", "--command", CMD)
    assert code != 0 and "설치할 때만" in out, out
    assert not (home / ".herdr-custom" / "claude-oauth.json").exists()


def test_setup_lists_claude_oauth_before_my_tabs(home):
    code, out = run(home, "setup.py")
    lines = [ln.split()[0] for ln in out.splitlines() if ln.strip()]
    assert "claude-oauth" in lines and lines.index("claude-oauth") < lines.index("my-tabs")


# ---- my-tabs 패치 ----

def test_oauth_patches_only_when_mod_exists(tmp_path, monkeypatch):
    monkeypatch.setattr(tabs, "mod_js", lambda name: str(tmp_path / name / "main.js"))
    assert not any(p in tabs.patches() for p in tabs.OAUTH_PATCHES)
    (tmp_path / "claude-oauth").mkdir()
    (tmp_path / "claude-oauth" / "main.js").write_text("//", encoding="utf-8")
    assert all(p in tabs.patches() for p in tabs.OAUTH_PATCHES)


def test_both_buttons_sit_left_of_files_in_order():
    out = apply_patches(FAKE_TABS, tabs.RESUME_PATCHES + tabs.OAUTH_PATCHES, "tabs")
    lines = [ln.strip() for ln in out.splitlines()]
    i = lines.index(".child(resumeButton())")
    assert lines[i + 1] == ".child(oauthButton())" and "Files" in lines[i + 2]
    assert out.index("const oauthButton") < out.index("return h_flex().size_full()")
    assert 'mod: "claude-oauth", kind: "dialog"' in out


def test_oauth_alone_patches():
    out = apply_patches(FAKE_TABS, tabs.OAUTH_PATCHES, "tabs")
    lines = [ln.strip() for ln in out.splitlines()]
    assert "Files" in lines[lines.index(".child(oauthButton())") + 1]


def test_button_size_matches_mod_json():
    with open(os.path.join(DESKTOP, "assets", "claude-oauth", "mod.json"), encoding="utf-8") as f:
        overlay = json.load(f)["overlay"]
    assert "width: %d, height: %d" % (overlay["width"], overlay["height"]) in tabs.OAUTH_RENDER


# ---- mod 순수 함수 (gpui·herdr 를 가짜로 바꿔 node 로) ----

HARNESS = r"""
const View = class {}; const div = () => null; const svg = () => null;
const h_flex = () => null; const v_flex = () => null; const InputState = {}; const Input = {};
const hc = null, exec = null, appHome = () => "C:\\Users\\me\\.config\\herdr-app", props = null, closeOverlay = null, theme = null, checking = () => false, readTextFile = null;
const fs = {};
"""


def run_js(tmp_path, body: str):
    src = re.sub(r"^import .*?;\n", "", read_main(), flags=re.M)
    src = HARNESS + src.replace("export default class", "class").replace("export function", "function") + "\n" + body
    p = tmp_path / "t.mjs"
    p.write_text(src, encoding="utf-8")
    r = subprocess.run([NODE, str(p)], capture_output=True, text=True, timeout=30, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


needs_node = pytest.mark.skipif(not NODE, reason="node 없음")


@needs_node
def test_main_js_parses(tmp_path):
    p = tmp_path / "main.mjs"
    p.write_text(read_main(), encoding="utf-8")
    r = subprocess.run([NODE, "--check", str(p)], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr


@needs_node
def test_parse_config(tmp_path):
    out = run_js(tmp_path, r'''
const t = (s) => { try { return parseConfig(s); } catch (e) { return "ERR " + e.message; } };
console.log(JSON.stringify([
  t('{"on":"srv","command":["docker","exec","-i","b","python","-m","oauth.cli"]}'),
  t(null), t("nope"), t('{"on":"a b","command":["x"]}'), t('{"on":"srv","command":[]}'),
  t('{"on":"srv","command":["rm","-rf","~;"]}'), t('{"on":"srv","command":"docker"}'),
]));''')
    assert out[0] == {"on": "srv", "command": ["docker", "exec", "-i", "b", "python", "-m", "oauth.cli"]}
    assert all(isinstance(x, str) and x.startswith("ERR") for x in out[1:])


@needs_node
def test_exec_args(tmp_path):
    out = run_js(tmp_path, r'''
const cfg = { on: "srv", command: ["c", "-m", "x"] };
console.log(JSON.stringify([execArgs(cfg, ["rename", "ab12cd34", "회사 계정"], 60), execArgs(cfg, ["add"], 100, true)]));''')
    assert out[0] == ["exec", "--on", "srv", "--timeout", "60", "--", "c", "-m", "x", "rename", "ab12cd34", "회사 계정"]
    assert out[1] == ["exec", "-i", "--on", "srv", "--timeout", "100", "--", "c", "-m", "x", "add"]


@needs_node
def test_parse_result(tmp_path):
    out = run_js(tmp_path, r'''
const t = (r) => { try { return parseResult(r); } catch (e) { return "ERR " + e.message; } };
console.log(JSON.stringify([
  t({ code: 0, stdout: '{"tokens":[],"active_id":null}\n', stderr: "" }),
  t({ code: 0, stdout: 'warning line\n{"tokens":[]}\n', stderr: "" }),
  t({ code: 1, stdout: '{"error":"\uc9c0\uae08 \uc4f0\ub294 \ud1a0\ud070", "status": 400}\n', stderr: "" }),
  t({ code: 1, stdout: "", stderr: '{"error":{"kind":"x","message":"machine srv is not connected"}}' }),
  t({ code: 127, stdout: "", stderr: "" }),
  t({ code: 1, stdout: '{"tokens":[]}', stderr: "" }),
]));''')
    assert out[0] == {"tokens": [], "active_id": None}
    assert out[1] == {"tokens": []}
    assert out[2] == "ERR 지금 쓰는 토큰"
    assert out[3] == "ERR machine srv is not connected"
    assert out[4] == "ERR 종료 코드 127"
    assert out[5].startswith("ERR")  # 종료 코드가 0 이 아니면 JSON 이어도 실패


@needs_node
def test_powershell_encoding_and_script(tmp_path):
    script = "$x = '회사'\nWrite-Output $x"
    out = run_js(tmp_path, r'''
const cfg = { on: "srv", command: ["docker", "exec", "-i", "b", "python", "-m", "oauth.cli"] };
console.log(JSON.stringify({
  enc: encodePowerShell(%s),
  script: addScript(cfg, "C:/Users/it's/a.json"),
  ascii: asciiJson({ label: "회사 계정", token: "sk-ant-oat01-x" }),
}));''' % json.dumps(script))
    assert out["enc"] == base64.b64encode(script.encode("utf-16-le")).decode()
    assert "$f = 'C:/Users/it''s/a.json'" in out["script"]
    assert "& hc 'exec' '-i' '--on' 'srv' '--timeout' '100' '--' 'docker'" in out["script"]
    assert out["script"].rstrip().endswith("exit $LASTEXITCODE")
    assert out["ascii"].isascii() and json.loads(out["ascii"]) == {"label": "회사 계정", "token": "sk-ant-oat01-x"}


@needs_node
def test_overview_and_usage_shapes(tmp_path):
    out = run_js(tmp_path, r'''
const o = toOverview({ tokens: [{ id: "ab12cd34", label: "회사", hint: "AAAA", created_at: 1 }], active_id: "ab12cd34",
  machines: { server: { state: "applied" }, pc: { state: "pending", error: null } } });
const u = toUsageMap({ tokens: { ab12cd34: { ok: true, five_hour: null, seven_day: { pct: 42.5, resets_at: "2026-11-30T01:00:00+00:00" }, checked_at: 5 } },
  login: { ok: false, error: "x" } });
console.log(JSON.stringify({ o, u, busy: isBusy(o), idle: isBusy(toOverview({ machines: { server: { state: "applied" } } })) }));''')
    assert out["o"]["tokens"] == [{"id": "ab12cd34", "label": "회사", "hint": "AAAA"}]
    assert out["o"]["activeId"] == "ab12cd34" and out["busy"] is True and out["idle"] is False
    assert out["u"]["tokens"]["ab12cd34"]["sevenDay"]["pct"] == 42.5
    assert out["u"]["login"] == {"ok": False, "fiveHour": None, "sevenDay": None, "checkedAt": 0, "error": "x"}


@needs_node
def test_headroom_sort_suggestion_and_summary(tmp_path):
    out = run_js(tmp_path, r'''
const U = (seven, five = null, at = "2026-11-25T09:00:00Z") => ({ ok: true, fiveHour: five === null ? null : { pct: five, resetsAt: at }, sevenDay: { pct: seven, resetsAt: at }, checkedAt: 0, error: null });
const ov = { tokens: [{ id: "aaaa1111", label: "회사", hint: "AAAA" }, { id: "bbbb2222", label: "서브", hint: "BBBB" }], activeId: "aaaa1111", machines: {} };
const usage = { login: U(50), tokens: { aaaa1111: U(30, 85), bbbb2222: { ok: false, error: "x" } } };
const entries = buildEntries(ov, usage);
const now = Date.parse("2026-11-24T08:30:00Z");
console.log(JSON.stringify({
  order: entries.map((e) => e.key),
  pct: usedPct(usage.tokens.aaaa1111),
  suggest: (() => { const s = pickSwitchTarget(entries, "aaaa1111"); return s && [s.current.key, s.target.key]; })(),
  noSuggest: pickSwitchTarget(entries, "login"),
  summary: summaryText(usage.tokens.aaaa1111, false, now),
  blocked: summaryText(U(100), false, now).endsWith("까지 막힘"),
  until: [untilText("2026-11-24T08:42:00Z", now), untilText("2026-11-24T18:00:00Z", now), untilText("2026-11-29T09:30:00Z", now), untilText("2026-11-24T08:00:00Z", now)],
}));''')
    assert out["order"] == ["login", "aaaa1111", "bbbb2222"]  # 50% < 85%(5시간이 더 참) < 모름
    assert out["pct"] == 85
    assert out["suggest"] == ["aaaa1111", "login"]  # 85% ≥ 70% → 가장 여유 있는 로그인 계정
    assert out["noSuggest"] is None                  # 50% 는 추천 없음
    assert out["summary"] == "1일 0시간 뒤 초기화 · 5시간 85%"
    assert out["blocked"] is True
    assert out["until"] == ["12분 뒤", "9시간 30분 뒤", "5일 1시간 뒤", "곧"]


def test_config_rules_match_installer():
    import install_claude_oauth as inst
    js = read_main()
    assert "const MACHINE_RE = /^%s$/;" % inst.MACHINE_RE.pattern in js
    assert "const ARG_RE = /^%s$/;" % inst.ARG_RE.pattern.replace("/", "\\/") in js
    assert "const MAX_COMMAND_PARTS = %d;" % inst.MAX_COMMAND_PARTS in js
