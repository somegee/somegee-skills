"""앱 0.1.16 대응 — my-spaces 의 activeAt(활성 공간으로 스크롤) 보정과, 옛·새 원본 모두에 패치가 걸리는지.

앱 원본 mod 코드는 저장소에 넣지 않는다(공개 저장소). 실제 원본으로도 보려면 원본 폴더를 주고 돌린다:
  HERDR_MOD_SRC=<폴더> python -m pytest desktop/tests/test_app_0116.py
  <폴더>/<판 이름>/tabs.js·spaces.js (판 이름은 아무거나, 예: v115·v116) — 판마다 패치가 끝까지 걸리고 node --check 통과
"""
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))
import install_spaces_tree as spaces_tree  # noqa: E402
import install_tabs_agent_name as tabs  # noqa: E402

NODE = shutil.which("node")
SRC = os.environ.get("HERDR_MOD_SRC")


def drawn_span_js() -> str:
    m = re.search(r"  drawnSpan\(w, collapsed\) \{\n.*?\n  \}\n", spaces_tree.METHODS, re.S)
    assert m, "METHODS 에 drawnSpan 이 없음"
    return m.group(0)


def active_at_expr() -> str:
    """TREE_PATCHES 가 0.1.16 원본에 넣는 activeAt 계산 줄."""
    for entry in spaces_tree.TREE_PATCHES:
        for _old, new in entry if isinstance(entry, list) else [entry]:
            m = re.search(r"this\.activeAt = (.*);", new)
            if m:
                return m.group(1)
    raise AssertionError("activeAt 패치가 없음")


@pytest.mark.skipif(not NODE, reason="node 없음")
@pytest.mark.parametrize("collapsed, expect", [
    (False, 4),  # A 행 + A 세션 2줄 + B 행(접힘) → C 는 다섯 번째(4)
    (True, 2),  # 좁은 화면(compact)은 공간마다 한 줄
])
def test_active_at_counts_open_session_rows(collapsed, expect):
    script = """
class Fake {
  constructor() { this.open = {A: true, B: false, C: true}; this.sessions = {A: [1, 2], B: [1, 2, 3], C: [1]}; }
  isOpen(w) { return this.open[w.id]; }
  sessionsOf(w) { return this.sessions[w.id]; }
%s
  calc(rows, collapsed) { const act = rows.findIndex(r => r.w.active); return %s; }
}
const rows = [{w: {id: "A"}}, {w: {id: "B"}}, {w: {id: "C", active: true}}];
console.log(JSON.stringify([new Fake().calc(rows, %s), new Fake().calc(rows.map(r => ({w: {...r.w, active: false}})), false)]));
""" % (drawn_span_js(), active_at_expr(), "true" if collapsed else "false")
    out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == [expect, -1]  # 활성 공간이 없으면 -1(원본과 같음)


@pytest.mark.skipif(not SRC, reason="HERDR_MOD_SRC 없음(실제 앱 원본으로 볼 때만)")
def test_patches_apply_to_each_app_version(tmp_path):
    versions = sorted(d for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d)))
    assert versions
    for v in versions:
        for name, build in (("tabs", tabs.patched), ("spaces", spaces_tree.build)):
            with open(os.path.join(SRC, v, name + ".js"), encoding="utf-8") as f:
                out = build(f.read())  # 고칠 문장을 못 찾으면 PatchError 로 멈춘다
            assert ("closeArm" in out) == (name == "tabs")
            if NODE:
                path = tmp_path / ("%s-%s.mjs" % (v, name))
                path.write_text(out, encoding="utf-8")
                r = subprocess.run([NODE, "--check", str(path)], capture_output=True, text=True, timeout=30)
                assert r.returncode == 0, (v, name, r.stderr)
