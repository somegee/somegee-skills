---
name: terminal-swarm
description: Agent Swarm을 위한 headless 터미널 세션 관리. 포커스 이동 없이 터미널 생성/입력/출력 제어. 
allowed-tools: Bash
---

# Terminal Swarm — Claude Code Instructions

## 스킬 실행 시 자동 처리 (필수)

사용자가 이 스킬을 호출하면, 아래 순서를 **자동으로** 수행한다:

1. **Python 경로 확인**: `~/.swarm/config.json`에서 `python_path` 읽기. 없으면 `python`을 사용
1-1. **의존성 확인**: `python -c "import winpty, winotify, websockets, pyte, watchdog"` 로 필수 패키지 설치 여부 확인. 미설치 시 `pip install pywinpty winotify websockets pyte watchdog` 실행
    - `watchdog`는 Files 탭 실시간 워처(OS 네이티브 `ReadDirectoryChangesW`)에 사용된다. 없으면 데몬은 정상 실행되지만 `/files/watch` SSE가 503을 반환하고 Files 탭은 수동 ↻ 새로고침에만 의존한다.
2. **SWARM 변수 설정**: 위에서 확인한 python 경로로 `SWARM` 변수 설정
3. **Hooks 설정 확인**: `$SWARM hooks status`로 Claude Code hooks 설정 여부 확인. 미설정 시 `$SWARM hooks setup` 실행. **반드시 데몬 시작 전에 실행하여, 프리셋 복원으로 생성되는 세션에도 hooks가 적용되도록 한다.**
4. **데몬 상태 점검**: `$SWARM status`로 데몬 실행 여부 확인
5. **데몬 시작** (미실행 시): `$SWARM start`를 `run_in_background: true`로 실행, 이후 `status`로 정상 기동 확인
6. **세션 목록 확인**: `$SWARM list`로 현재 실행 중인 세션 파악
7. **대시보드 안내**: 사용자에게 `http://localhost:7890/` 에서 대시보드를 확인할 수 있다고 알림. 첫 사용자에게는 Quick Launch의 `claude` 항목을 클릭하면 Claude Code 세션이 바로 생성된다고 안내

데몬이 이미 실행 중이면 5는 건너뛴다.

### SWARM 변수 설정

```bash
# 플러그인 캐시 또는 로컬에서 swarm.py 자동 탐색
_swarm_py="$(ls ~/.claude/plugins/cache/*/terminal-swarm/*/skills/terminal-swarm/scripts/swarm.py 2>/dev/null | tail -1)"
[ -z "$_swarm_py" ] && _swarm_py=".claude/skills/terminal-swarm/scripts/swarm.py"
SWARM="$(cat ~/.swarm/config.json 2>/dev/null | python -c "import sys,json;print(json.load(sys.stdin).get('python_path','python'))" 2>/dev/null || echo python) $_swarm_py"
```

config가 없으면 `$SWARM config init`로 초기화.

## 주요 기능

### Hook stale path 복구 (1.6.6+)

플러그인 업데이트(예: 1.5.9 → 1.6.6) 후 `~/.claude/settings.json`에 박혀 있던
`terminal-swarm/<old-version>/.../hook_relay.py` 절대 경로가 stale 상태가 되어
hook이 조용히 실패하던 문제를 수정.

- **`_build_swarm_hook_command`가 더 이상 절대 경로를 settings.json에 박지 않는다.**
  hook_relay.py와 동일한 동작을 수행하는 한 줄 Python을 인라인으로 임베드한다.
  플러그인 버전과 무관하게 영구 동작.
- **`python3` 우선, `python` fallback**: bash에서 PATH 기반으로 해석 (Windows
  python.exe 절대 경로의 백슬래시 이스케이프 문제도 동시에 회피).
- **`hooks status`가 stale을 자동 감지**: 등록된 swarm hook command가 현재 기대
  형식과 다르면 exit 1을 반환. BAT 런처의 `hooks status → hooks setup` 흐름이
  outdated 인스톨을 자동 재설정한다.
- 부수적으로 `_find_hook_relay()`의 lexical sort 버그(`"1.5.9" > "1.5.12"`)도
  사라졌다 — 함수 자체를 삭제했기 때문.

### WebSocket 연결 안정성 (1.6.5+)

장시간 작업/대량 출력 도중 web UI pane의 키보드 입력이 멎는 zombie 연결 문제를 해결.

- **서버 → 클라이언트 application-level 하트비트**: 15초마다 NUL 바이트(`\x00`) 전송. xterm.js가 NUL을 무시하므로 시각적 영향 없음. 클라이언트가 `lastActivity`를 갱신하여 stale 감지 기준으로 사용한다.
- **클라이언트 stale 감지**: 5초 주기로 `lastActivity` 검사. 40초간 메시지가 없으면 강제 `ws.close()` → onclose → reconnect. onclose가 영영 안 오는 진성 zombie를 위해 5초 fallback 타이머도 둔다.
- **bridge 스레드 누수 제거**: `_ws_handler`가 `asyncio.to_thread(threading.Event.wait)` 대신 PTY 리더 스레드에서 `loop.call_soon_threadsafe(data_event.set)`로 직접 통신. 기존에는 disconnect마다 1개 스레드가 누수되어 ~32회 reconnect 후 default ThreadPoolExecutor가 고갈되었다.
- **`pty.write` 이벤트 루프 블로킹 방지**: `session.write_stdin()`을 `asyncio.to_thread`로 위임하여, 한 pane의 PTY 블로킹이 다른 모든 pane의 WebSocket을 멎게 하지 않게 한다.
- **reconnect race 가드**: `handleClose`가 두 번 발화하거나 force-close와 자연 close가 race할 때 reconnect가 중복 트리거되지 않도록 `c.ws !== ws` 식별자 가드 추가.

### 보안 강화 (1.6.1+)

- **DNS rebinding 방어**: 모든 HTTP/WebSocket 엔드포인트가 `Host` 헤더 화이트리스트(`localhost:7890`, `127.0.0.1:7890`, `[::1]:7890`)를 검증. 미일치 시 403/1008 응답.
- **CORS origin 제한**: `Access-Control-Allow-Origin: *` → `http://localhost:7890`.
- **경로 화이트리스트**: `/files/tree`, `/files/read`, `/files/write`는 `os.getcwd()` 하위 경로만 허용. 위반 시 403.
- **Command 이스케이프**: `Session.start()`의 bash/powershell/cmd 셸 경로 전부 command injection 방지 이스케이프 적용.
- **SSE 안정성**: `_handle_sse`에 15초 heartbeat(`: ping`) 추가로 스레드풀 고갈 방지. `/files/watch` 구독자 수 상한(32) 적용.
- **클라이언트 exponential backoff**: Files 탭 EventSource 재연결이 고정 3초 → 3/6/12/24/48/60s로 증가. 성공 수신 시 리셋. `beforeunload`에서 cleanup.

### Files 탭 실시간 워처 (1.6.0+)

OS 네이티브 파일시스템 이벤트(`ReadDirectoryChangesW`)를 `watchdog`로 구독하여
Files 탭이 `/files/watch` SSE를 통해 **수동 새로고침 없이 자동 갱신**된다.

- 200ms 서버측 디바운스 + 300ms 클라이언트 코얼레싱으로 `git pull` 같은 대량 변경도 안전하게 처리
- 이벤트는 캐시된(화면에 표시된) 디렉토리만 재조회 → 보이지 않는 경로는 CPU/네트워크 소모 없음
- `.git/index`, `.git/HEAD`, `.git/refs/*` 변경은 git status 갱신 트리거
- 무시 대상: `.git`, `node_modules`, `__pycache__`, `venv`, `.venv`, `dist`, `build`, `.next`, `.cache`, `.turbo`, `.parcel-cache` + `config.json`의 `tree_ignore`
- SSE 연결이 끊기면 3초 후 자동 재연결, 15초 heartbeat(`: ping`)로 프록시 타임아웃 방지
- watchdog 미설치 시 `/files/watch`는 503 반환, 대시보드는 수동 새로고침으로 fallback

### Standalone 앱 윈도우 실행 (1.6.0+)

`create_bat.py`가 생성한 배치파일은 대시보드를 기본 브라우저 대신
**Edge/Chrome의 `--app=` 모드**로 띄워 chromeless 윈도우처럼 보이게 한다.

- 탐지 순서: Edge(64/86) → Chrome(64/86) → 기본 브라우저 fallback
- 자체 user-data-dir(`%LOCALAPPDATA%\TerminalSwarm\WebApp`)를 지정하여
  작업표시줄 아이콘과 쿠키/세션을 일반 브라우저 프로필과 분리
- 창 크기 기본값: 1400x900

### 세션 삭제 flicker 방지 (1.6.0+)

✕ 버튼 클릭 시 프론트엔드가 세션을 즉시 숨기면서 백그라운드 DELETE를 보내는데,
DELETE 응답 전에 폴링(`/sessions`)이 끼어들면 세션이 잠깐 되살아나는 race가 있었다.
`_pendingDelete` Set으로 가드를 추가하여 DELETE 응답 후 1.5초까지 폴링을 필터링한다.

## 명령어 레퍼런스

```bash
# 데몬 제어
$SWARM start                          # 데몬 시작 (반드시 run_in_background: true)
$SWARM status                         # 데몬 상태 확인
$SWARM stop                           # 데몬 + 모든 세션 종료

# 세션 관리
$SWARM create <name> -c "cmd" -d /path  # 세션 생성 (-s 셸 지정 가능)
$SWARM list                             # 세션 목록
$SWARM rename <old> <new>               # 이름 변경
$SWARM kill <name>                      # 세션 종료
$SWARM kill-all                         # 모든 세션 종료

# 입출력
$SWARM send <name> <text...>            # 텍스트 입력 (자동 \r)
$SWARM send <name> -c "/resume"         # /로 시작하는 텍스트 (MSYS 경로변환 방지)
$SWARM send <name> --enter              # Enter 키 전송
$SWARM send <name> --key up             # 키 전송 (up/down/ctrl-c/tab/home/end/...)
$SWARM send <name> --key down --repeat 3  # 키 반복
$SWARM send <name> -r -c "raw text"     # raw 모드 (자동 \r 없음)
$SWARM send <name> -f /path/to/file     # 파일 내용을 base64로 전송
echo "text" | $SWARM send <name> -b     # stdin -> base64 전송
$SWARM read <name> -n 20                # 최근 N줄 읽기
$SWARM read <name> -g "ERROR"           # 패턴 필터링
$SWARM read <name> -r                   # 헤더 없이 raw 출력

# 완료 대기 (블로킹)
$SWARM wait <name> --ready              # Claude Code 응답 완료까지 대기 (hooks 기반, 기본 타임아웃 300초)
$SWARM wait <name> --ready -t 600       # ready + 타임아웃
$SWARM wait <name> --exit               # 프로세스 종료까지 대기
$SWARM wait <name> -g "DONE"            # 패턴 출력까지 대기
$SWARM wait <name> -i 10                # 10초 idle 대기

# Quick Launch
$SWARM fav list                         # 목록
$SWARM fav add <name> <command> [-d cwd]  # 추가
$SWARM fav del <name>                   # 삭제
$SWARM fav launch <name>                # 실행

# Hooks / Config
$SWARM hooks setup|status|remove        # Claude Code hooks 관리
$SWARM config show|init|set|get         # 설정 관리
```

## Claude Code 세션 제어 규칙

### permission 프롬프트 응답

**중요: 선택지 개수가 2개일 때와 3개일 때가 다르다. 반드시 `read`로 프롬프트 내용을 먼저 확인한 후 응답해야 한다.**

#### 선택지 2개 (Yes / No)
```bash
# Yes (기본 선택)
$SWARM send <name> --enter

# No
$SWARM send <name> --key down
$SWARM send <name> --enter
```

#### 선택지 3개 (Yes / Yes, don't ask again / No)
```bash
# Yes (기본 선택)
$SWARM send <name> --enter

# Yes, don't ask again
$SWARM send <name> --key down
$SWARM send <name> --enter

# No
$SWARM send <name> --key down --repeat 2
$SWARM send <name> --enter
```

**주의**: 2개 선택지에서 `--key down --repeat 2`를 보내면 의도치 않은 동작이 발생한다. **항상 read로 선택지 개수를 확인한 후 올바른 키 입력을 보내라.**

### 장문 전송

**임시 파일(Write) 생성 금지. heredoc 파이프를 사용한다.**

```bash
cat <<'EOF' | $SWARM send <name> --base64
전송할 내용
EOF
```

## 에이전트 간 통신 규칙

오케스트레이터가 다른 Claude Code 세션을 제어할 때 반드시 따르는 규칙.

### 채널 분리

| 대상 | 방법 | 내용 |
|------|------|------|
| **사용자** | 텍스트 출력 | 상태 보고, 결과 요약 |
| **다른 세션** | `send` 명령 | 처리할 지시/데이터**만** |

**금지**: 진행 보고("~를 기다리겠습니다")를 다른 세션에 send하지 마라.

### 메시지 전송 규칙

1. **장문은 heredoc 파이프로** — 임시 파일 생성 금지
2. **send 후 별도 --enter 불필요** — base64 모드는 자동 `\r` 추가
3. **한 번에 하나의 지시만** — 여러 지시를 한꺼번에 보내면 혼란

### 응답 대기 패턴

```bash
# 1. 메시지 전송
cat <<'EOF' | $SWARM send worker -b
작업 지시 내용
EOF

# 2. 응답 대기 (★ 권장: --ready)
$SWARM wait worker --ready -t 120
# 반환 이벤트: ready / attention / exit / timeout

# 3. attention이면 permission 프롬프트 또는 질문 응답
$SWARM send worker --enter

# 4. 결과 읽기
$SWARM read worker -n 30
```

**금지**: send 직후 read 없이 바로 다음 send를 보내지 마라.

### 오케스트레이터 올바른 흐름

```
1. 사용자에게: "worker-1에게 작업을 지시합니다."
2. send: 작업 내용만 전송 (보고 문구 제외)
3. wait: 응답 대기
4. read: 결과 확인
5. 사용자에게: "worker-1 작업 완료. 결과: ..."
```

## Agent Swarm 패턴

```bash
# 세션 생성
$SWARM create worker-1 -c "claude -p 'Fix bug #1'" -d /path/to/repo
$SWARM create worker-2 -c "claude -p 'Add tests'" -d /path/to/repo

# 완료 감지
$SWARM wait worker-1 --ready
$SWARM wait worker-2 --ready
```

## BAT 바로가기 생성 (필수 규칙)

**"bat", "배치파일", "바로가기", "런처" 등의 키워드가 포함된 요청은 반드시 이 섹션의 규칙을 따른다.**
**절대로 자체적으로 bat 파일을 작성하지 마라. 반드시 `create_bat.py`를 사용한다.**

### 절차

**Step 1: 사용자에게 두 가지를 질문한다 (반드시 물어봐야 함, 추측 금지)**

> 1. BAT 파일을 어디에 만들까요? (예: `C:\Users\me\Desktop\Terminal Swarm.bat`)
> 2. 작업 디렉토리는 어디로 할까요? (예: `C:\Users\me\projects`) — 데몬이 이 경로에서 실행됩니다.

**Step 2: 사용자가 두 경로를 모두 알려주면, `create_bat.py`를 실행한다**

```bash
_create_bat="$(ls ~/.claude/plugins/cache/*/terminal-swarm/*/skills/terminal-swarm/scripts/create_bat.py 2>/dev/null | tail -1)"
[ -z "$_create_bat" ] && _create_bat=".claude/skills/terminal-swarm/scripts/create_bat.py"
python "$_create_bat" "<bat_path>" "<work_dir>"
```

### 금지사항
- **직접 bat 파일 내용을 작성하지 마라** — 반드시 `create_bat.py`만 사용
- **경로를 추측하지 마라** — 반드시 사용자에게 물어본다
- **~/bin, PATH, swarm.bat 등 CLI 래퍼를 만들지 마라** — 이 기능은 데몬 전체 초기화를 포함한 런처 BAT 생성 전용이다

## Error Handling

| 에러 | 조치 |
|------|------|
| `Daemon is not running` | `$SWARM start` (백그라운드) |
| `Session already exists` | `$SWARM kill <name>` 후 재생성 |
| `Session not found` | `$SWARM list`로 확인 |
| `Failed to send` | `$SWARM read <name>`으로 종료 원인 확인 |
