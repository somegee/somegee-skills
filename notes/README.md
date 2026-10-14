# notes — Claude Code 옆 창 노트 모드

에이전트가 작업 계획·진행 상황·종료 조건을 탭별 노트로 적고, 사용자는 옆 창에서 바로 확인한다.
대화를 위로 올려 "아까 거 어디까지 했지?"를 찾지 않아도 되게 하는 것이 목적이다.

## 할 수 있는 것

- **탭 여러 개**: 에이전트가 작업마다 탭을 만들고 이름도 직접 짓는다. 상단 탭 버튼으로 전환.
- **체크리스트**: 단계를 끝내면 에이전트가 체크(☑ + 취소선). 내용 수정은 창에서 하지 않고 대화로 에이전트에게 말한다. 줄 어디를 눌러도 직접 체크·해제된다.
- **목표·종료 조건·결과물·메모** 구역별 표시. 결과물(커밋·PR·파일·링크)은 따로 모인다.
- **지금 하는 단계**: 안 끝난 첫 단계 앞에 ▶ 와 서서히 바뀌는 배경색.
- **막힘·대기**: 단계 아래에 ⛔ 막힘 / ⏳ 대기 사유, 풀리면 ↳ 해결 내역이 남는다. 안 끝난 단계에 막힘이 있으면 탭 이름이 빨강·⛔, 대기만 있으면 노랑·⏳ 으로 바뀌어 다른 탭을 보는 중에도 눈에 띈다.
- **세션·갱신 시각**: 제목 아래에 이 탭을 다룬 세션 이름(/rename 이름, 없으면 자동 제목이나 세션 번호)과 마지막 갱신 시각.
- **[✕ 닫기]**: 아래 버튼 줄 오른쪽 끝.
- **구역 접기**: 목표·종료 조건·할 일·결과물·메모 제목을 누르면 접히고(▸ + 개수 요약) 다시 누르면 펴진다.
- **[↶ 되돌리기] / [↷ 앞으로]**: 최근 변경 20건을 하나씩 되돌리고, 되돌린 것은 다시 할 수 있다(새로 고치면 앞으로 기록은 사라짐)(체크·탭 지우기·에이전트 수정 모두).
- **세션 간 공유**: 같은 작업 폴더에서 연 세션끼리 노트 내용을 공유한다(3초마다 반영). 보고 있는 탭은 세션마다 따로.
- **사용 규칙 자동 적용**: 세션마다 지시하지 않아도, 여러 단계 작업이면 에이전트가 알아서 탭을 만든다.

## 설치 (Claude Code 2.1.287 이상)

somegee-skills 마켓플레이스에서 설치한다.

```
claude plugin marketplace add somegee/somegee-skills
claude plugin install notes@somegee-skills --scope user
```

이미 켜져 있는 세션에서는 `/reload-plugins`, 그다음 `/notes` 로 옆 창을 연다.
여러 PC가 같은 판을 쓰려면 `/plugin` → Marketplaces → somegee-skills → 자동 업데이트를 켠다.
코드를 고칠 때마다 `.claude-plugin/plugin.json` 의 version 을 올려야 다른 PC에 반영된다.

## 알아 둘 것

- 노트는 `~/.claude/notes-data/<작업폴더>.json` 에 저장된다(플러그인 버전이 바뀌어도 유지). PC마다 따로이고 외부로 아무것도 보내지 않는다.
- 본문은 마우스 휠로만 스크롤한다. 방향키는 버튼 사이 초점 이동에만 쓰인다.
- 언어: `/config` 에서 notes 의 「언어 / Language」를 `한국어`(기본) 또는 `English` 로 고른다. 창 문구·도구 설명·에이전트 사용 규칙이 함께 바뀌고, 새 세션부터 적용된다.
- 세션을 시작하면 옆 창이 저절로 열린다(기본값). 끄려면 `/config` 에서 notes 의 「세션 시작 시 notes 창 자동 열기」를 끈다.
- 터미널이 144칸보다 좁으면 옆 창이 자동으로 열리지 않는다. 그때는 `/notes` 로 연다.
- VS Code 확장, `claude -p`(무인 실행)에서는 창이 그려지지 않는다.
- 개발 중에는 `claude --plugin-dir <이 폴더>` 로 띄우고 고친 뒤 `/reload-plugins`.

## 제거

```
claude plugin uninstall notes@somegee-skills
```

## English

notes is a Claude Code mod: the agent writes its plan, progress and finish line into per-task tabs, and you watch them in a side pane — no more scrolling back to find "where were we?".

- Install: `claude plugin marketplace add somegee/somegee-skills` then `claude plugin install notes@somegee-skills --scope user`.
- Language: open `/config`, find notes → "언어 / Language" and pick `English`. The pane, tool descriptions and the agent guide switch to English from the next session.
- Every session in the same project folder shares one set of notes. A tab whose open steps are blocked turns red with ⛔; waiting only, yellow with ⏳.
- Headless runs (`claude -p`, cron, SDK) and subagents never touch the notes.
