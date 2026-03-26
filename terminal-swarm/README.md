# Terminal Swarm

Agent Swarm을 위한 headless 터미널 세션 관리 스킬.
포커스 이동 없이 여러 에이전트의 터미널을 생성하고, 입출력을 제어한다.

## 주요 기능

- **멀티 세션 관리**: 여러 터미널 세션을 동시에 생성/제어
- **웹 대시보드**: `http://localhost:7890`에서 모든 세션을 실시간 모니터링
- **파일 트리 탐색**: CWD 기반 폴더/파일 트리 + 검색 + 에디터
- **Git 상태 표시**: 파일명 색상 변경 + M/U/A/D 뱃지로 변경 상태 표시 (VSCode 스타일, git CLI 필요 — 없으면 자동 비활성화)
- **Claude Code Hooks 연동**: 작업 진행/완료/권한요청 상태를 실시간 감지
- **데스크톱 알림**: winotify를 통한 Windows 토스트 알림
- **Quick Launch**: 자주 쓰는 명령을 CLI/대시보드에서 관리
- **프리셋**: 레이아웃, 세션 배치, 사이드바 비율을 슬롯별 저장/복원

## 아키텍처

```
[Daemon (localhost:7890)]
    ├── HTTP API ──→ CLI (Claude Code Bash에서 호출)
    ├── WebSocket ──→ 대시보드 실시간 스트리밍
    ├── Hooks    ──→ Claude Code 상태 수신 (Stop/PermissionRequest/UserPromptSubmit)
    └── Sessions ──→ [worker-1] [worker-2] [worker-3] ...
```

## 의존성

```bash
pip install pywinpty websockets winotify
```

| 패키지 | 용도 | 필수 |
|--------|------|------|
| `pywinpty` | Windows PTY — 인터랙티브 터미널 세션 생성 | Yes |
| `websockets` | 대시보드 실시간 통신 (없으면 HTTP 폴링으로 폴백) | No |
| `winotify` | Windows 토스트 알림 — 작업 완료/승인 요청 시 데스크톱 알림 | Yes |
| `git` (CLI) | 파일 트리 Git 상태 표시 (M/U/A/D 뱃지, 파일명 색상) | No — 없으면 Git 표시만 비활성화 |

## 빠른 시작

```bash
# SWARM 변수 설정
SWARM="$(cat ~/.swarm/config.json 2>/dev/null | python -c "import sys,json;print(json.load(sys.stdin).get('python_path','python'))" 2>/dev/null || echo python) .claude/skills/terminal-swarm/scripts/swarm.py"

# 1. 데몬 시작
$SWARM start

# 2. Hooks 설정 (최초 1회)
$SWARM hooks setup

# 3. 브라우저에서 http://localhost:7890 접속

# 4. 세션 생성
$SWARM create worker-1 -c "claude -p 'Fix bug #1'" -d /path/to/repo
```

## CLI 명령어

### 데몬 제어
```bash
$SWARM start                          # 데몬 시작
$SWARM status                         # 상태 확인
$SWARM stop                           # 데몬 + 모든 세션 종료
```

### 세션 관리
```bash
$SWARM create <name> -c "cmd" -d /path  # 세션 생성
$SWARM list                             # 세션 목록
$SWARM rename <old> <new>               # 이름 변경
$SWARM kill <name>                      # 세션 종료
$SWARM kill-all                         # 모든 세션 종료
```

### 입출력
```bash
$SWARM send <name> <text>             # 텍스트 입력
$SWARM send <name> --enter            # Enter 키 전송
$SWARM send <name> --key up           # 키 전송 (up/down/ctrl-c/tab/...)
$SWARM send <name> -f /path/to/file   # 파일 내용 전송 (base64)
$SWARM read <name> -n 20              # 최근 20줄 읽기
$SWARM read <name> -g "ERROR"         # 패턴 필터링
```

### 완료 대기
```bash
$SWARM wait <name> --ready            # Claude Code 응답 완료까지 대기
$SWARM wait <name> -g "DONE"          # 패턴 출력까지 대기
$SWARM wait <name> --exit             # 프로세스 종료까지 대기
$SWARM wait <name> -i 10              # 10초 idle 대기
```

### Quick Launch
```bash
$SWARM fav list                       # 목록 조회
$SWARM fav add <name> <command>       # 추가
$SWARM fav del <name>                 # 삭제 (경로/명령어 출력)
$SWARM fav launch <name>              # 실행
```

### Hooks 설정
```bash
$SWARM hooks setup                    # ~/.claude/settings.json에 hooks 등록
$SWARM hooks status                   # 설정 상태 확인
$SWARM hooks remove                   # hooks 제거
```

### Config
```bash
$SWARM config show                    # 전체 설정 보기
$SWARM config init                    # Python 경로 자동 감지
$SWARM config set <key> <value>       # 수동 설정
```

## 대시보드 기능

### 세션 상태 표시 (Hooks 기반)
| 상태 | 불빛 | 트리거 |
|------|------|--------|
| `active` | 초록불 깜빡임 | 사용자 입력 제출 (UserPromptSubmit) |
| `ready` | 파란불 | 응답 완료 (Stop) |
| `attention` | 노란불 깜빡임 + 알림 | 권한 요청 (PermissionRequest) |

### 사이드바
- **Sessions**: 세션 목록 + 상태 불빛
- **Files**: Pinned 파일 + CWD 기반 트리 탐색 + 파일 검색
- **Quick Launch**: 즐겨찾기 명령/파일 (CLI와 동기화)
- 섹션 간 **드래그로 높이 조절** 가능 (프리셋에 저장)

### Pane
- 터미널 / 에디터 / 브라우저 pane 분할
- 헤더에 세션 이름 + 부제목 (명령어 또는 파일 경로)
- 파일 드래그로 에디터 열기
- 프리셋으로 레이아웃 저장/복원 (1~4 슬롯)

## 파일 구조

| 파일 | 용도 |
|------|------|
| `scripts/swarm.py` | 데몬 + CLI 통합 스크립트 |
| `scripts/dashboard.html` | 웹 대시보드 UI |
| `SKILL.md` | Claude Code가 읽는 스킬 정의 (명령어 레퍼런스 + 행동 규칙) |
| `~/.swarm/config.json` | Python 경로 등 환경 설정 |
| `~/.swarm/quicklaunch.json` | Quick Launch 데이터 |
| `~/.swarm/logs/` | 세션별 출력 로그 |
| `~/.swarm/presets.json` | 대시보드 프리셋 |
