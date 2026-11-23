# herdr 데스크톱 앱 커스텀 (Windows)

herdr 데스크톱 앱(herdr-app)에 아래 9가지를 깔아 주는 묶음입니다. **기능마다 상태를 보고, 낡았거나 없는 것만 고칩니다** — 이미 최신인 기능의 파일은 건드리지 않습니다(다시 쓰면 그 직후 단축키가 잠깐 안 먹는 일이 있었음).
다른 PC 에서도 이 폴더를 통째로 옮겨 `1_설치.bat` 을 더블클릭하면 됩니다.

| # | 기능 | 어디서 보이나 |
|---|---|---|
| 1 | **기본 레이아웃을 내 것(`my-main`)으로 복제** — "설정해도 계속 기본값으로 돌아감" 해결. 아래 2~8 이 모두 이 위에 얹힘 | 화면 전체 |
| 2 | **`/rename` → 탭 이름 따라가기** — 세션 이름을 바꾸거나, 첫 대화 뒤 Claude 가 제목을 지으면 상단 탭 이름이 그걸로 바뀜 | 상단 탭 |
| 3 | **Ctrl+Shift+V 이미지 붙여넣기** — 클립보드가 그림이면 PNG 로 저장해 경로를 붙여 Claude 가 그림으로 읽음 (글자면 그냥 글자) | 터미널 |
| 4 | **좌하단 Agents 목록** — `공간이름 · 세션명` 대신 세션명만 + 작업 중인 세션 아래에 "지금 하는 일" | 좌하단 Agents |
| 5 | **상단 탭 바** — 이름 없는 Claude 탭은 `2` 대신 `Claude Code`(앱 0.1.16 부터는 앱이 직접 프로그램 이름·Claude 제목을 보여 줌) + 탭을 끌 때 놓일 자리에 점선 + **x 를 한 번 누르면 빨간 바탕, 3초 안에 한 번 더 눌러야 닫힘**(실수로 바로 닫히지 않게) | 상단 탭 |
| 6 | **Ctrl+N → 새 터미널 탭** — 앱 자체 기능(`tab.new`)을 Ctrl+N 에 건다. 예전판(Ctrl+N → 새 Claude 탭)은 키가 자주 안 먹어서 뺐고, 깔려 있으면 치운다. Claude 탭은 우상단 `+` 메뉴로 | 어디서든 Ctrl+N |
| 7 | **좌상단 Spaces 접기/펼치기** — 공간 줄 왼쪽 ▾/▸ 로 그 공간의 세션 목록을 펼침. 세션마다 이름 + 상태(작업 중 도는 표시 / `Needs you` / 끝남 채운 점 / 쉬는 중 빈 동그라미), 작업 중이면 아래 작은 글씨로 하는 일. 세션 줄을 누르면 그 창으로 이동, **끌어서 다른 공간 줄에 놓으면 그 공간으로 옮김**(같은 기기만, 대화는 안 끊김). 펼침 상태는 앱을 다시 켜도 유지(처음엔 선택된 공간만 펼침). **마지막 세션을 닫아 세션이 0개가 된 공간은 흐린 빈 줄로 남는다**(이름을 붙인 공간만) — 누르면 같은 이름·폴더·색으로 다시 열리고(기본 셸 탭 1개), 다른 세션을 끌어다 놓을 수도 있다. 줄 오른쪽 `×` 는 완전히 없애기 | 좌상단 Spaces |
| 8 | **우상단 `Resume` — 종료된 Claude 세션 일괄 이어하기** — 재부팅·로그아웃 뒤 herdr 를 켜면 탭은 그대로인데 claude 는 꺼지고 셸만 남습니다. Files 왼쪽 `Resume` 버튼(이어할 세션이 있으면 강조 + `Resume 3` 처럼 개수)을 누르면 그런 탭 목록이 뜨고(마지막 답변 시각·권한 모드, 최근 순), 고른 탭마다 `claude --resume` 으로 이전 대화를 엽니다. 권한 옵션(`--dangerously-skip-permissions` 등)은 대화 기록을 보고 자동으로 붙입니다. 일부러 끈 세션은 줄 오른쪽 `삭제`로 목록에서 뺍니다(탭·대화 기록은 남음). 이 PC 탭만 | 우상단 |
| 9 | **앱 설정** — 어두운 화면 + 사용 통계 안 보냄 (`settings.json` 의 `appearance`·`telemetry` 두 항목만, 되돌리면 적용 전 값) | 앱 전체 |

4·5·7번(좌하단 Agents·상단 탭·좌상단 Spaces)에서 **'끝남' 세션은 눌러 봐도 끝남(채운 점)으로 남고, 다른 세션을 누를 때 '쉬는 중'(빈 동그라미)으로 바뀝니다**(앱 기본은 누르는 순간 바뀜 — 표시만 늦춤).

## 준비물

- **herdr 데스크톱 앱** 설치되어 있고 **켜져 있을 것** (`%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`)
- **Python 3.9 이상** (`python` 명령이 되어야 함)
- 3번(이미지 붙여넣기)은 Windows 기본 .NET Framework 4 의 `csc.exe` 로 작은 프로그램을 직접 빌드합니다(인터넷 다운로드 없음).
  `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 가 없으면 3번만 실패하고 나머지는 깔립니다.

## 설치

1. herdr 앱을 켭니다.
2. (Claude Code 에서는 `/herdr-desktop:herdr-custom 설치` 로 고르는 화면을 띄워 골라 깔 수도 있습니다.) 먼저 **`2_상태확인.bat`** (또는 `python setup.py`) — 기능마다 `최신` / `낡음(무엇이 다른지)` / `없음` / `손으로 고친 흔적` / `고칠 문장 못 찾음` 이 나옵니다. 아무것도 바꾸지 않습니다.
   **한 번에 전부(만든 사람 세팅 그대로):** `python setup.py --mine` (Claude Code 에서는 `/herdr-desktop:herdr-custom 내세팅`) — 1~9 를 모두 깝니다. 최신인 건 안 건드립니다.
3. **`1_설치.bat`** 더블클릭 (또는 `python setup.py --apply`) — 낡음·없음인 기능만 고칩니다. 몇 개만 고르려면 `python setup.py --apply title-sync,my-spaces`. 미리보기는 `python setup.py --dry-run`.
4. 끝에 나오는 결과에서 모든 기능이 `최신`, `바뀐 파일`, `앱: … 오류 없음`, 그리고 **「사람이 눌러 볼 것」**(바뀐 기능만)을 확인합니다.

여러 번 실행해도 결과는 같습니다(최신이면 `변경 없음`, 파일 시각도 그대로).

- 기능 이름: `title-sync`(1·2) · `image-paste`(3) · `my-agents`(4) · `my-tabs`(5) · `newtab-key`(6) · `my-spaces`(7) · `resume-all`(8 — 버튼은 5번 `my-tabs` 안에 있어 둘 다 필요)
- **손으로 고친 흔적**: 설치본 mod 파일을 직접 고쳐 둔 경우입니다(설치 기록 `%USERPROFILE%\.config\herdr-app\.herdr-custom\installed.json` 과 비교). 그대로 두고 멈추며, 덮으려면 `--apply <이름> --force` — 덮기 전에 `.herdr-custom\backup\<시각>\` 로 백업합니다.
- 기능 하나만: `python scripts\install_<…>.py --status` / `--dry-run` / (옵션 없음 = 적용) / `--remove` 이 PC 의 앱 설정 폴더는 `%USERPROFILE%\.config\herdr-app\` 입니다.

## 확인 방법 (직접 눌러 보기)

| 기능 | 해 볼 것 |
|---|---|
| 2 | Claude 탭에서 `/rename 테스트` → 2초쯤 뒤 상단 탭 이름이 `테스트` |
| 3 | `Win+Shift+S` 로 캡처 → Claude 창에서 `Ctrl+Shift+V` → 그림 **한 장** 붙음 |
| 4 | Claude 가 일하는 중일 때 좌하단 Agents 에 세션명 + 아래 작은 글씨로 하는 일 |
| 5 | `+` 로 새 Claude 탭 → 탭 이름이 번호가 아님(`Claude Code` 또는 Claude 제목) / 탭을 끌면 점선 |
| 5 | 상단 탭의 x 를 한 번 누름 → x 바탕이 빨갛게(탭은 그대로) → 3초 안에 한 번 더 → 닫힘 / 한 번 누르고 3초 기다리면 원래 색으로 |
| 6 | `Ctrl+N` → 지금 공간에 새 터미널 탭 **하나** |
| 8 | 우상단 Files 왼쪽에 흐린 `Resume` → herdr **밖** PowerShell 에서 `hc server stop` → `hc server start`(재부팅과 같은 상태, 일하던 Claude 의 진행 중 답변은 잘림) → `Resume N` 으로 강조 → 누르면 팝업에 탭별 마지막 답변 시각·권한 배지 → `선택한 N개 이어하기`(Enter) → 각 탭에서 claude 가 이전 대화로 열리고 버튼 숫자가 줄어듦. 가볍게: 아무 셸 탭에 `hc label <t> claude.session=<기존 세션 id> claude.project=<기록 폴더 이름>` → `Resume 1` (끝나면 그 탭 닫기) |
| 4·5·7 | 다른 세션에 있을 때 끝난(채운 점) 세션을 누름 → **계속 채운 점**(탭 점·공간 점도 그대로) → 다른 세션을 누르면 그때 빈 동그라미 |
| 7 | 좌상단 공간 줄 왼쪽 ▾ 누르면 세션 목록이 접히고(▸) 다시 누르면 펼쳐짐 — 이때 **선택된 공간은 안 바뀜** / 세션 줄 누르면 그 창으로 이동 / 앱 껐다 켜도 펼침·접힘 그대로 / 공간을 끌어 순서 바꾸기도 그대로 됨 / 세션 없는 공간엔 버튼 없음 / 세션 줄을 다른 공간 줄로 끌면 그 줄에 점선 → 놓으면 그 공간으로 넘어가고 대화가 그대로 이어지며 탭 이름도 그대로 / 다시 원래 공간으로 끌어 옮기기 / 같은 공간 안에서 세션 줄을 다른 세션 줄 위로 끌면 그 줄에 점선 → 놓으면 그 탭 자리로 순서가 바뀜(상단 탭 순서도 같이, 0.7.2) / 목록 밖에 놓으면 취소 |

이 동작들은 SSH 나 `hc send` 로는 시험할 수 없고, 그 PC 앞에서 직접 눌러야 합니다.

## 상태 확인 · 되돌리기

- **`2_상태확인.bat`** — 아무것도 바꾸지 않고 기능별 상태만 보여 줌 (`python setup.py --status`, `--json` 가능)
- **`3_되돌리기.bat`** — 전부 해제하고 기본 레이아웃(`main`)으로 돌아감. 복제본 파일은 남겨 둠(`mods\resume-all\` 만 지움)
- **완전 삭제** — 되돌리기 후 `%USERPROFILE%\.config\herdr-app\` 에서 `layouts\my-main.json`, `mods\my-agents\`, `mods\my-tabs\`, `mods\my-spaces\` 를 지움
- 화면이 망가졌을 때 비상 탈출: 앱에서 **`Ctrl+Alt+Shift+Esc`** (기본 화면으로 복귀)

## 알아 둘 점

- **기본 레이아웃·기본 mod 는 읽기 전용**입니다. 앱을 켤 때마다 원본으로 덮어쓰기 때문에 직접 고치면 안 되고, 이 묶음처럼 복제본을 고칩니다.
- **단축키가 mod 를 가리키면 앱이 그 mod 칸을 스스로 넣습니다.** 손으로 또 넣으면 두 번 동작합니다(그림 두 장). 설치 스크립트는 이를 감안해 중복이면 하나만 남깁니다.
- 이미지 붙여넣기 뒤 클립보드에는 그림 대신 PNG 파일이 남습니다(그림판에 바로 붙이기는 안 됨). 저장 위치 `C:\Users\Public\herdr-paste\`, 하루 지나면 자동 삭제. 다른 기기(원격) 창은 손대지 않습니다.
- **Ctrl+N 은 앱이 먼저 받습니다**(터미널 안에서도). 그래서 터미널 프로그램 쪽 Ctrl+N(Claude 입력 기록 아래로 이동 등)은 못 씁니다 — 기록 이동은 방향키 ↓ 로. 원래 단축키 설정은 `keys.json.bak-newtabkey` 로 백업됩니다. Ctrl+N 이 이미 다른 동작에 걸려 있으면 설치가 멈추고 알려 줍니다.
- `Ctrl+Shift+V` 가 원래 하던 글자 붙여넣기는 그대로 됩니다(클립보드가 글자일 때). 원래 단축키 설정은 `keys.json.bak-imagepaste` 로 백업됩니다.
- 좌하단 Agents 에 안 보이는 Claude 탭이 있으면: 백그라운드로 돌던 세션을 `/resume` 으로 연 경우입니다 → `claude stop <id>` 후 그 탭에서 `claude --resume`.
- `Alt+위/아래` 는 Agents 목록 순서, `Ctrl+PageUp/PageDown` 이 상단 탭 순서입니다(버그 아님).

## herdr 업데이트 후

커스텀은 **날아가지 않고** 업데이트도 정상 적용됩니다(업데이트가 덮어쓰는 건 기본 파일뿐). 4·5·7번 복제본(my-agents·my-tabs·my-spaces)은 새 기본 mod 에서 다시 만든 내용과 비교되므로, 앱이 바뀌면 `2_상태확인.bat` 에 `낡음` 으로 나오고 `1_설치.bat` 으로 새 버전의 기본 화면 개선을 받습니다. 복제본 `main.js` 를 손으로 고쳤으면 `손으로 고친 흔적` 으로 멈추니, 계속 쓸 수정이면 `scripts\` 의 설치 스크립트를 고치세요.

1. `2_상태확인.bat` — 모두 `최신` 이면 **할 일 없음**.
2. 새 버전의 탭 바·Agents·Spaces 개선을 받고 싶거나 화면이 깨졌으면:
   1. 앱에서 `Ctrl+Shift+L` 로 `main` 레이아웃으로 전환 (또는 `Ctrl+Alt+Shift+Esc`)
   2. `%USERPROFILE%\.config\herdr-app\` 의 `layouts\my-main.json`, `mods\my-agents\`, `mods\my-tabs\`, `mods\my-spaces\` 를 다른 폴더로 옮김(백업)
   3. `1_설치.bat` 다시 실행 → 새 버전을 다시 복제하고 수정만 다시 얹음
- 기본 mod 코드가 크게 바뀌면 스크립트가 **"고칠 문장을 못 찾음"** 으로 멈춥니다(엉뚱하게 고친 채로 남지 않음). 그때는 `scripts\install_agents_name_only.py` / `install_tabs_agent_name.py` / `install_spaces_tree.py` 의 `PATCHES` 를 새 코드에 맞춰야 합니다.

## 폴더 구성

```
herdr-custom/
├── 1_설치.bat / 2_상태확인.bat / 3_되돌리기.bat   더블클릭용 (setup.py --apply / --status / --remove)
├── setup.py                       전 기능 상태표·미리보기·고른 것만 적용·되돌리기
├── scripts/
│   ├── install_title_sync.py       2 (+ 1 레이아웃 복제)   --remove 로 개별 해제
│   ├── install_image_paste.py      3
│   ├── install_agents_name_only.py 4
│   ├── install_tabs_agent_name.py  5
│   ├── install_newtab_key.py       6 (예전 Ctrl+N 새 Claude 탭 치우기 포함)
│   ├── install_resume_all.py       8 (버튼은 5번 my-tabs 가 넣음)
│   ├── done_hold.py                4·5·8 공용: '끝남'을 다른 세션 누를 때까지 끝남으로 보이기
│   ├── install_spaces_tree.py      8
│   ├── patchlib.py                 4·5·7 공용: 원본 mod 에서 다시 고친 내용 만들기(다를 때만 덮어씀)
│   ├── featurelib.py               공용: 상태 판정·미리보기·같은 내용이면 안 쓰기·설치 기록·백업
│   └── apphome.py                  앱 설정 폴더 위치(HERDR_APP_HOME 으로 바꿀 수 있음)
├── tests/                          상태 판정·같은 내용이면 안 씀·done_hold 테스트 (python -m pytest tests)
└── assets/
    ├── title-sync/                 mod 원본 (main.js, mod.json)
    ├── image-paste/                mod 원본 + clipimg.cs (설치 때 빌드)
    └── resume-all/                 9 팝업 mod (main.js, read_sessions.ps1 — 대화 기록 읽기만, mod.json, resume.svg)
```


2026-11-04, herdr-core 0.1.16 기준으로 만들고 0.1.17 에서 확인함. 지금 7번(Spaces)은 2026-11-05 herdr-app 0.1.13 에서 시험 적용으로 확인함.
