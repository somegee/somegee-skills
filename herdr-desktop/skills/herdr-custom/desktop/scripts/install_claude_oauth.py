"""herdr 앱(Windows)에 claude-oauth mod 를 설치한다 (우상단 OAuth 버튼 → Claude 계정(OAuth 토큰) 전환 팝업).

토큰 보관함·반영·사용량 조회는 서버 쪽 백엔드에 있고, 팝업은 설정 파일에 적힌 기기에서 명령을 돌려 그 백엔드에 부탁만 한다:
  hc exec --on <on> -- <command...> overview | usage [--refresh] | activate <id> | reset | rename <id> <이름> | delete <id> | add(표준입력)
명령은 성공하면 응답 JSON, 실패하면 {"error": "..."} 한 줄을 써야 한다. 설정 파일: APP_HOME/.herdr-custom/claude-oauth.json
  {"on": "<기기 이름 — hc machine ls>", "command": ["<프로그램>", "<인자>", ...]}
팝업을 여는 우상단 `OAuth` 버튼은 my-tabs 안에 있다 → 설치·제거 뒤 my-tabs 를 다시 맞춘다(refresh).

  python install_claude_oauth.py --on <기기> --command "<그 기기에서 돌릴 명령>"   # 설정 파일을 만들거나 바꾸고 설치
  python install_claude_oauth.py            # 낡음·없음이면 설치, 최신이면 '변경 없음' (설정 파일은 그대로)
  python install_claude_oauth.py --status   # 상태 한 줄(--json) / --dry-run 미리보기
  python install_claude_oauth.py --remove   # mod 폴더를 지우고 my-tabs 에서 OAuth 버튼을 뺀다(설정 파일은 남김)
팝업 mod(place: none)라 레이아웃 칸은 없다. 같은 내용이면 mod 파일을 다시 쓰지 않는다.
"""
import io
import json
import os
import re
import shlex
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from install_title_sync import APP_HOME, asset_wants, copy_assets  # noqa: E402
from featurelib import STATE_DIR, Plan, run_cli  # noqa: E402
import install_tabs_agent_name  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FEATURE = MOD = install_tabs_agent_name.OAUTH_MOD
FILES = ("main.js", "mod.json", "key.svg")
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", MOD)
MOD_DIR = os.path.join(APP_HOME, "mods", MOD)
CONFIG = os.path.join(STATE_DIR, "claude-oauth.json")
# mod 의 parseConfig() 와 같은 규칙 — 설정은 명령으로 그대로 실행되므로 글자를 좁힌다
MACHINE_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")
ARG_RE = re.compile(r"[A-Za-z0-9._/:=@+-]{1,200}")
MAX_COMMAND_PARTS = 16
READ_ONLY_FLAGS = ("--status", "--check", "--dry-run", "--remove")


def make_config(on: str, command: str) -> dict:
    parts = shlex.split(command)
    if not MACHINE_RE.fullmatch(on or ""):
        sys.exit("--on 은 기기 이름(영문·숫자·._-)이어야 합니다: %r" % on)
    if not parts or len(parts) > MAX_COMMAND_PARTS or not all(ARG_RE.fullmatch(p) for p in parts):
        sys.exit("--command 는 영문·숫자·._/:=@+- 로 된 낱말 %d개 이하여야 합니다: %r" % (MAX_COMMAND_PARTS, command))
    return {"on": on, "command": parts}


def write_config(cfg: dict) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    with io.open(CONFIG, "w", encoding="utf-8") as f:
        f.write(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
    print("설정 파일:", CONFIG, "→", cfg["on"], " ".join(cfg["command"]))


def take_config_args(argv: list) -> list:
    """--on X --command "..." 를 꺼내 설정 파일을 쓰고 나머지 인자를 돌려준다(둘은 같이 줘야 함)."""
    rest, vals, i = [], {}, 0
    while i < len(argv):
        if argv[i] in ("--on", "--command"):
            if i + 1 >= len(argv):
                sys.exit("%s 뒤에 값이 필요합니다" % argv[i])
            vals[argv[i]] = argv[i + 1]
            i += 2
            continue
        rest.append(argv[i])
        i += 1
    if vals:
        if len(vals) != 2:
            sys.exit("--on 과 --command 는 같이 줘야 합니다")
        other = [a for a in rest if a in READ_ONLY_FLAGS]
        if other:  # 미리보기·상태·되돌리기가 몰래 실행 대상(설정)을 바꾸지 않게
            sys.exit("--on/--command 는 설치할 때만 씁니다 (%s 와 같이 못 씀)" % ", ".join(other))
        write_config(make_config(vals["--on"], vals["--command"]))
    return rest


def plan():
    return Plan(FEATURE, files=asset_wants(SRC, MOD_DIR, FILES),
                present=os.path.exists(os.path.join(MOD_DIR, "main.js")))


def install():
    changed = copy_assets(SRC, MOD_DIR, FILES)
    print("mod 파일:", ", ".join(changed) + " 바꿈" if changed else "그대로")
    if not os.path.exists(CONFIG):
        print("!! 설정 파일이 없음 — 팝업이 '설정이 필요합니다'로 뜬다. --on <기기> --command \"<명령>\" 로 만드세요:", CONFIG)
    install_tabs_agent_name.refresh()  # my-tabs 가 있으면 OAuth 버튼을 넣는다(없으면 my-tabs 설치 때 들어감)


def remove():
    if os.path.exists(MOD_DIR):
        shutil.rmtree(MOD_DIR, ignore_errors=True)
        print("지움:" if not os.path.exists(MOD_DIR) else "!! 못 지움(앱이 잡고 있는 듯, 손으로 지우세요):", MOD_DIR)
    else:
        print("없음 —", MOD_DIR)
    install_tabs_agent_name.refresh()  # 없는 mod 를 여는 버튼이 남지 않게


if __name__ == "__main__":
    sys.argv = sys.argv[:1] + take_config_args(sys.argv[1:])
    run_cli(FEATURE, plan, install, remove)
