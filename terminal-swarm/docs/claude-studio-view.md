# Claude Studio View

> xterm.js 대신 구조화된 커스텀 UI로 Claude Code 세션을 렌더링하는 새로운 pane 타입

## 배경

기존 terminal-swarm은 xterm.js로 Claude Code의 raw PTY 출력을 그대로 보여줌.
이 방식의 한계:
- ANSI escape 기반 렌더링 → 플리커, 스크롤 이슈
- 도구 호출 결과가 터미널 텍스트에 묻힘
- statusline, 입력창 위치가 고정되지 않음
- 세션 메타데이터(토큰, 비용 등)를 별도로 파싱해야 함

## 핵심 아이디어

Claude Code CLI의 `--output-format stream-json` + `--input-format stream-json`을 활용해
PTY 대신 **구조화된 JSON 이벤트**로 통신하고, 이를 **시맨틱 UI 컴포넌트**로 렌더링.

```
기존:  PTY → raw ANSI → xterm.js (그대로 렌더)
신규:  stdin/stdout JSON → 파서 → 커스텀 UI 컴포넌트
```

## 검증 결과 (2026-04-07)

### stream-json 포맷 확인

Claude Code CLI 플래그:
```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --permission-mode <mode>
```

### 입력 포맷
```json
{"type":"user","message":{"role":"user","content":"사용자 메시지"}}
```

### 출력 이벤트 타입

| 이벤트 | 설명 | 주요 필드 |
|--------|------|-----------|
| `system` (subtype: `init`) | 세션 초기화 | session_id, model, tools, permissions |
| `assistant` | Claude 응답 | message.content[] (text / tool_use 블록) |
| `user` | 도구 실행 결과 | tool_result 내용 |
| `rate_limit_event` | 사용량 정보 | utilization, resetsAt |
| `result` | 턴 완료 | total_cost_usd, num_turns, usage |

### assistant 이벤트 content 블록 구조

**텍스트 블록:**
```json
{"type":"text","text":"Claude의 응답 텍스트"}
```

**도구 호출 블록:**
```json
{
  "type":"tool_use",
  "id":"toolu_xxx",
  "name":"Read",
  "input":{"file_path":"..."}
}
```

### 멀티턴 동작 확인

- stdin으로 여러 메시지를 순차 전송 가능
- 각 메시지마다 `system/init` → `assistant` → `result` 사이클 반복
- 세션 컨텍스트 유지됨 (이전 대화 기억)

## 프로토타입 구현

### 파일 위치 (로컬 테스트용)
```
C:\Users\김지윤\Desktop\projects\.claude\skills\claude-studio\
├── SKILL.md
└── scripts/
    ├── server.py      # aiohttp 기반 HTTP + WebSocket 서버
    └── studio.html    # 커스텀 UI 대시보드
```

### 아키텍처

```
[브라우저 studio.html]
    ↕ WebSocket (ws://localhost:7895/ws/<name>)
[server.py]
    ↕ stdin/stdout (JSON lines)
[claude -p --input-format stream-json --output-format stream-json --verbose]
```

### server.py 구조

- `ClaudeSession` — Claude Code 프로세스 관리
  - `asyncio.create_subprocess_exec`로 spawn
  - stdout readline → JSON 파싱 → WebSocket broadcast
  - WebSocket input → stdin write
  - 메타데이터 추적 (cost, tokens, turns, state)
- `SessionManager` — 다중 세션 관리
- aiohttp 라우트:
  - `GET /` → dashboard HTML
  - `GET/POST/DELETE /api/sessions` → 세션 CRUD
  - `GET /ws/<name>` → WebSocket (양방향)

### studio.html UI 구성

```
┌─────────────────────────────────────────────┐
│ [state] model │ tokens │ cost │ turns │ cwd │  ← statusline
├──────────┬──────────────────────────────────┤
│ Sessions │  채팅 메시지 영역 (스크롤)        │
│          │                                  │
│ • sess-1 │  [assistant text → 마크다운 버블] │
│ • sess-2 │  [tool_use → 접이식 카드]        │
│          │  [tool_result → 결과 표시]       │
│          │  [result → 턴 구분선]            │
│          ├──────────────────────────────────┤
│ [+New]   │  [입력창 — 항상 하단 고정]  [전송]│
└──────────┴──────────────────────────────────┘
```

**렌더링 컴포넌트:**
- 텍스트 응답 → `marked.js` 마크다운 렌더링
- 코드 블록 → `highlight.js` 구문 강조
- 도구 카드 → 도구별 아이콘/색상, 접기/펼치기
  - Edit → 인라인 diff 뷰 (삭제줄/추가줄)
  - Bash → 명령어 + 실행 결과
  - Read → 파일 경로
  - Grep/Glob → 패턴 표시
- statusline → 실시간 state/model/tokens/cost/turns
- thinking indicator → 3-dot 애니메이션

### 현재 상태

**동작하는 것:**
- 세션 생성/삭제/전환
- 메시지 전송 → Claude 응답 수신 → UI 렌더링
- 도구 호출 카드 (접이식)
- Edit diff 뷰
- statusline 실시간 업데이트
- 멀티세션 사이드바
- 자동 스크롤

**개선 필요:**
- [ ] 도구 결과(user 이벤트) 매칭 정확도 향상 — 현재 순서 기반, ID 매칭으로 변경 필요
- [ ] `--include-partial-messages` 활용한 스트리밍 텍스트 (현재는 전체 메시지 단위)
- [ ] permission 이벤트 처리 — default 모드에서 승인 UI 필요
- [ ] 세션 resume 기능 (`--resume <session_id>`)
- [ ] 테마 시스템 (terminal-swarm과 통일)
- [ ] terminal-swarm 통합 — 새 pane 타입 `claude-studio`로 추가
- [ ] WebSocket 재연결 로직 강화
- [ ] 긴 도구 결과 가상 스크롤 / 접기

## terminal-swarm 통합 계획

terminal-swarm에 통합 시 변경이 필요한 부분:

### swarm.py
- `Session` 클래스에 `mode` 필드 추가 (`pty` | `studio`)
- studio 모드: PTY 대신 `asyncio.subprocess`로 Claude 프로세스 관리
- WebSocket 핸들러에서 모드별 분기

### dashboard.html
- 새 pane 타입 `claude-studio` 추가
- pane 생성 시 xterm.js 대신 커스텀 렌더러 마운트
- 기존 split/layout 시스템과 통합
- 테마 변수 공유

### 호환성
- 기존 pty 기반 세션은 그대로 유지
- 세션 생성 시 모드 선택 가능
- Claude Code 세션만 studio 모드 적용, 일반 터미널은 기존 xterm.js
