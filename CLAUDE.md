# somegee-skills

개인 Claude Code 플러그인 마켓플레이스. 현재 `terminal-swarm`, `notes`(mod — 옆 창 노트) 플러그인 관리.

## 구조

```
terminal-swarm/
  plugin.json          # 플러그인 메타데이터 (version 필수 관리)
  skills/
    terminal-swarm/
      SKILL.md         # Claude Code 스킬 정의
      scripts/
        swarm.py       # 메인 데몬 스크립트
notes/                 # mod 플러그인 (옆 창 노트)
  .claude-plugin/plugin.json
  hooks/register.tsx   # mod 본체
  tests/notes.test.tsx
  types/index.d.ts
```

**이 저장소는 PUBLIC이다.** 비밀값·업무 내용을 올리지 않는다.

## 플러그인 수정 규칙

**모든 플러그인(terminal-swarm·notes 등) 공통: 수정할 때마다 그 플러그인의 `.claude-plugin/plugin.json` version 범프 필수** — 빠뜨리면 다른 PC(로컬·서버·회사)의 플러그인이 갱신되지 않음.

- 수정은 이 작업 폴더에서만 한다. `~/.claude/plugins/cache/...`·`~/.claude/plugins/marketplaces/somegee-skills`는 업데이트 때 덮어써지는 사본이라 직접 고치지 않는다.

```json
{
  "version": "1.5.12"  // 수정할 때마다 patch 버전 +1
}
```

버전 형식: semver (`major.minor.patch`)

## SKILL.md 동적 경로 탐색 패턴

스킬 내에서 `swarm.py` 경로를 찾을 때:

```bash
# 플러그인 캐시에서 최신 버전 탐색 (tail -1 = 최신, head -1 금지)
_swarm_py="$(ls ~/.claude/plugins/cache/*/terminal-swarm/*/skills/terminal-swarm/scripts/swarm.py 2>/dev/null | tail -1)"
# 로컬 폴백
[ -z "$_swarm_py" ] && _swarm_py=".claude/skills/terminal-swarm/scripts/swarm.py"
```

- `head -1` 사용 금지 — semver 정렬 시 1.10 < 1.9로 잘못 정렬됨
- `tail -1`로 사전순 마지막(= 최신 버전) 선택

## notes (mod) 규칙

- 테스트: `claude plugin test notes`, 검증: `claude plugin validate notes` (저장소 루트에서 `claude plugin validate .` 도)
- 개발 중 실행: `claude --plugin-dir notes` 로 띄우고 고친 뒤 `/reload-plugins`
- 데이터는 `$.plugin.root` 아래에 두지 않는다 — 마켓플레이스 설치본은 버전마다 폴더가 바뀌어 사라진다. 노트는 `~/.claude/notes-data/` 에 둔다.

## Hook 설정 규칙 (terminal-swarm)

터미널 스웜 훅은 `command` 타입으로 정의:

```json
{ "type": "command", "command": "..." }
```

- `daemon` 타입 사용 금지 — 데몬 미실행 시 에러 발생
- Windows Python 절대 경로 (`C:/Python313/python.exe`) 하드코딩 금지 — bash 호환 깨짐
- 훅 명령에서 Python 경로는 `~/.swarm/config.json`의 `python_path` 참조

## Windows 호환 주의사항

- 경로 구분자: bash 스크립트에서 `\` 금지, `/` 사용
- BAT 파일의 semver 버전 탐색: regex 패턴 사용 (`[0-9]+\.[0-9]+\.[0-9]+`)
- `pyte` 의존성: alt screen(TUI 앱) 캡처에 필요, 배치파일에서 자동 감지
- PTY 세션에서 환경변수 상속 주의 — `NO_FLICKER` 등이 PTY에 상속되면 한글 깨짐

## 개발 흐름

1. 플러그인 코드 수정 (`swarm.py`·`SKILL.md` / `notes/hooks/register.tsx` 등)
2. 그 플러그인의 `plugin.json` version 범프 (patch +1)
3. 로컬 테스트: terminal-swarm은 `python swarm.py status`, notes는 `claude plugin test notes`
4. 커밋 → PR → 머지
5. 플러그인 캐시 갱신 확인: `ls ~/.claude/plugins/cache/*/terminal-swarm/`
