"""mark_done.py — Agents 줄 우클릭 「끝남으로 표시」를 mod 코드에 넣기.

  python -m pytest herdr-desktop/skills/herdr-custom/desktop/tests
"""
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import mark_done  # noqa: E402
from featurelib import PatchError  # noqa: E402

# 기본 agents mod 에서 패치가 짚는 문장만 모은 것(넓은 줄·좁힌 줄 클릭이 둘 다 있다)
SRC = "\n".join([
    'import { agents, run, openOverlay, props } from "herdr";',
    "export default class Agents extends View {",
    "  init(_props, cx) {",
    "    if (props()?.sortMenu) return;",
    "  }",
    "  sortMenu(t) {",
    "    return null;",
    "  }",
    "  render(cx) {",
    "    if (props()?.sortMenu) return this.sortMenu(t);",
    "    const narrowRow = h_flex()",
    '          .on_click(() => run("pane.focus", { pane: a.pane }))',
    "          .child(x);",
    "    const row = h_flex()",
    '        .on_click(() => run("pane.focus", { pane: a.pane }))',
    "        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)",
    "  }",
    "}",
    "",
])


def test_apply_adds_menu_right_click_and_imports():
    out = mark_done.apply(SRC, "agents")
    assert "if (props()?.sortMenu || props()?.agentMenu) return;" in out
    assert "if (props()?.agentMenu) return this.agentMenu(t);" in out
    assert out.count("agentMenu(t) {") == 1 and out.index("agentMenu(t) {") < out.index("  sortMenu(t) {")
    assert out.count('.on_mouse_down("right"') == 1  # 넓은 줄에만
    assert "herdr.seen=${turn - 1}" in out
    assert 'import { agents, run, openOverlay, props, hc, closeOverlay } from "herdr";' in out
    assert out.index(mark_done.MARK) > out.index('from "herdr";')


def test_apply_twice_stops():
    with pytest.raises(SystemExit):
        mark_done.apply(mark_done.apply(SRC, "agents"), "agents")


def test_missing_anchor_raises():
    with pytest.raises(PatchError):
        mark_done.apply(SRC.replace("  sortMenu(t) {", "  sortBy(t) {"), "agents")


@pytest.mark.skipif(not shutil.which("node"), reason="node 없음")
def test_mark_js_behaviour(tmp_path):
    """markDone 이 seen=turn-1 을 붙이고, 끝난 턴이 없거나 읽기 실패면 이유를 돌려준다."""
    js = tmp_path / "check.mjs"
    js.write_text("\n".join([
        "let calls = [], turn = 5, fail = false;",
        "const hc = async (args) => { calls.push(args.join(' ')); if (fail) return { code: 1, stdout: '' };",
        "  return args[0] === 'get' ? { code: 0, stdout: JSON.stringify({ turn }) } : { code: 0, stdout: '' }; };",
        mark_done.MARK_JS,
        "let bad = 0; const eq = (a, b, l) => { if (a !== b) { bad++; console.log('FAIL', l, a, b); } };",
        "eq(await markDone('pc/t5'), null, 'ok');",
        "eq(calls[1], 'label pc/t5 herdr.seen=4', 'label');",
        "turn = 0; eq(await markDone('t1'), '아직 끝난 턴이 없습니다', 'turn0');",
        "fail = true; eq(await markDone('t1'), '세션을 읽지 못했습니다', 'fail');",
        "process.exit(bad ? 1 : 0);",
    ]), encoding="utf-8")
    r = subprocess.run(["node", str(js)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
