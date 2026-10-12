# notes — Claude Code 옆 창 노트 모드

에이전트가 작업 계획·진행 상황·종료 조건을 탭별 노트로 적고, 사용자는 옆 창에서 바로 확인한다.
대화를 위로 올려 "아까 거 어디까지 했지?"를 찾지 않아도 되게 하는 것이 목적이다.

## 할 수 있는 것

- **탭 여러 개**: 에이전트가 작업마다 탭을 만들고 이름도 직접 짓는다. 상단 탭 버튼으로 전환.
- **체크리스트**: 단계를 끝내면 에이전트가 체크(☑ + 취소선). 줄 어디를 눌러도 직접 체크·해제된다.
- **목표·종료 조건·메모** 표시
- **[✎ 편집]**: 탭 이름·목표·종료 조건·단계·메모를 직접 고친다. 문구 칸 Enter 또는 [저장] = 저장, [취소] = 저장 안 함, + 칸 = 단계 추가.
- **[↶ 되돌리기]**: 최근 변경 20건을 하나씩 되돌린다(직접 편집·체크·탭 지우기·에이전트 수정 모두).
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
- 터미널이 144칸보다 좁으면 옆 창이 자동으로 열리지 않는다. 그때는 `/notes` 로 연다.
- VS Code 확장, `claude -p`(무인 실행)에서는 창이 그려지지 않는다.
- 개발 중에는 `claude --plugin-dir <이 폴더>` 로 띄우고 고친 뒤 `/reload-plugins`.

## 제거

```
claude plugin uninstall notes@somegee-skills
```
