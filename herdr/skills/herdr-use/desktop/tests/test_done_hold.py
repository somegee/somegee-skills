"""done_hold.py — mod 코드에 '끝남 유지' 넣기 + 그 JS 의 동작(node 가 있으면).

  python -m pytest herdr/skills/herdr-use/desktop/tests
"""
import os
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import done_hold  # noqa: E402

SRC = "\n".join([
    'import { View } from "gpui-kit";',
    'import { spaces, run, knownAgents } from "herdr";',
    "// agents() 를 본다",
    "const a = agents().filter((x) => x.focused);",
    "const s = spaces().find((x) => x.active);",
    "const k = knownAgents();",
    "const m = this.agents();",
    "",
])


def test_apply_wraps_calls_and_adds_imports():
    out = done_hold.apply(SRC, "test")
    assert "const a = shownAgents().filter" in out
    assert "const s = shownSpaces().find" in out
    assert "knownAgents()" in out and "this.agents()" in out  # 다른 이름·메서드는 그대로
    assert 'import { spaces, run, knownAgents, agents } from "herdr";' in out
    # 도우미는 import 뒤, 도우미 안의 agents()·spaces() 는 원래 함수 그대로
    assert out.index(done_hold.MARK) > out.index('from "herdr";')
    assert "const raw = agents();" in out and "const raw = spaces();" in out


def test_apply_twice_stops():
    with pytest.raises(SystemExit):
        done_hold.apply(done_hold.apply(SRC, "test"), "test")


@pytest.mark.skipif(not shutil.which("node"), reason="node 없음")
def test_hold_js_behaviour(tmp_path):
    hold = tmp_path / "hold.js"
    hold.write_text(done_hold.HOLD_JS, encoding="utf-8")
    r = subprocess.run(["node", os.path.join(HERE, "done_hold_check.mjs"), str(hold)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
