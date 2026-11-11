# herdr 데스크톱 앱 커스텀 (Windows)

herdr 데스크톱 앱(herdr-app)에 아래 8가지를 한 번에 깔아 주는 묶음입니다.
다른 PC 에서도 이 폴더를 통째로 옮겨 `1_설치.bat` 을 더블클릭하면 됩니다.

| # | 기능 | 어디서 보이나 |
|---|---|---|
| 1 | **기본 레이아웃을 내 것(`my-main`)으로 복제** — "설정해도 계속 기본값으로 돌아감" 해결. 아래 2~8 이 모두 이 위에 얹힘 | 화면 전체 |
| 2 | **`/rename` → 탭 이름 따라가기** — 세션 이름을 바꾸거나, 첫 대화 뒤 Claude 가 제목을 지으면 상단 탭 이름이 그걸로 바뀜 | 상단 탭 |
| 3 | **Ctrl+Shift+V 이미지 붙여넣기** — 클립보드가 그림이면 PNG 로 저장해 경로를 붙여 Claude 가 그림으로 읽음 (글자면 그냥 글자) | 터미널 |
| 4 | **좌하단 Agents 목록** — `공간이름 · 세션명` 대신 세션명만 + 작업 중인 세션 아래에 "지금 하는 일" | 좌하단 Agents |
| 5 | **상단 탭 바** — 이름 없는 Claude 탭은 `2` 대신 `Claude Code` + 탭을 끌 때 놓일 자리에 점선 (+ `+` 버튼이 6번 메뉴를 엶) | 상단 탭 |
| 6 | **우상단 `+` 메뉴에 `ccd` 버튼** — `claude --dangerously-skip-permissions` 로 새 탭. 설치 때 정한 폴더에서 열린다(아래 「ccd 폴더」) | 우상단 `+` |
| 7 | **Ctrl+N → ccd 새 Claude 탭** — 6번과 같은 명령·같은 폴더를 키 하나로 | 어디서든 Ctrl+N |
| 8 | **좌상단 Spaces 접기/펼치기** — 공간 줄 왼쪽 ▾/▸ 로 그 공간의 세션 목록을 펼침. 세션마다 이름 + 상태(작업 중 도는 표시 / `Needs you` / 끝남 채운 점 / 쉬는 중 빈 동그라미), 작업 중이면 아래 작은 글씨로 하는 일. 세션 줄을 누르면 그 창으로 이동, **끌어서 다른 공간 줄에 놓으면 그 공간으로 옮김**(같은 기기만, 대화는 안 끊김). 펼침 상태는 앱을 다시 켜도 유지(처음엔 선택된 공간만 펼침). **마지막 세션을 닫아 세션이 0개가 된 공간은 흐린 빈 줄로 남는다**(이름을 붙인 공간만) — 누르면 같은 이름·폴더·색으로 다시 열리고(기본 셸 탭 1개), 다른 세션을 끌어다 놓을 수도 있다. 줄 오른쪽 `×` 는 완전히 없애기 | 좌상단 Spaces |

4·5·8번(좌하단 Agents·상단 탭·좌상단 Spaces)에서 **'끝남' 세션은 눌러 봐도 끝남(채운 점)으로 남고, 다른 세션을 누를 때 '쉬는 중'(빈 동그라미)으로 바뀝니다**(앱 기본은 누르는 순간 바뀜 — 표시만 늦춤).

## 준비물

- **herdr 데스크톱 앱** 설치되어 있고 **켜져 있을 것** (`%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`)
- **Python 3.9 이상** (`python` 명령이 되어야 함)
- 3번(이미지 붙여넣기)은 Windows 기본 .NET Framework 4 의 `csc.exe` 로 작은 프로그램을 직접 빌드합니다(인터넷 다운로드 없음).
  `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 가 없으면 3번만 실패하고 나머지는 깔립니다.

## 설치

1. herdr 앱을 켭니다.
2. **`1_설치.bat`** 더블클릭 (또는 `python setup.py`).
3. 끝에 나오는 결과에서 `지금 레이아웃: my-main`, 각 mod `칸 1개 OK`, `my-new-menu 파일 있음 · + 버튼 연결 OK`, `ccd 폴더 = …`, `앱 오류: 없음` 을 확인합니다.

여러 번 실행해도 결과는 같습니다(이미 된 건 건너뜀). 이 PC 의 앱 설정 폴더는 `%USERPROFILE%\.config\herdr-app\` 입니다.

### ccd 폴더 (6·7번 새 탭을 늘 같은 폴더에서 열기)

```
python setup.py --ccd-folder "C:\Users\<사용자>\Desktop\<폴더>"   # 이 폴더에서 열기
python setup.py --ccd-folder ""                                   # 지정 해제 → 공간 폴더
```

- 안 정하면 지금처럼 **공간(space)의 폴더**에서 열립니다. **다른 기기(원격) 공간**은 정해도 늘 그 공간의 폴더입니다(이 PC 경로가 그 기기엔 없으므로).
- 옵션 없이 다시 설치하면 **이미 정한 폴더를 그대로 둡니다.** 처음 설치할 때는 PowerShell 프로필에 `function ccd { Set-Location "<경로>"; … }` 가 있으면 그 경로를 찾아 쓰고 알려 줍니다(없거나 형식이 다르면 그냥 공간 폴더). `ccd` 함수가 없는 PC 에서도 아무 문제 없습니다 — 탭은 `claude` 를 직접 실행합니다.
- 정한 폴더가 없으면 설치 때 경고하고 공간 폴더로 둡니다. 설치 뒤 폴더를 지웠으면 누를 때 알림이 뜨고 공간 폴더에서 열립니다.
- `claude` 가 PATH 에 없으면 설치 때 경고합니다(`+` 메뉴엔 "not installed" 로 흐리게 보임).
- 6·7번 스크립트만 따로 돌릴 때도 같은 옵션을 씁니다: `python scripts\install_ccd_key.py --ccd-folder "<경로>"`.

## 확인 방법 (직접 눌러 보기)

| 기능 | 해 볼 것 |
|---|---|
| 2 | Claude 탭에서 `/rename 테스트` → 2초쯤 뒤 상단 탭 이름이 `테스트` |
| 3 | `Win+Shift+S` 로 캡처 → Claude 창에서 `Ctrl+Shift+V` → 그림 **한 장** 붙음 |
| 4 | Claude 가 일하는 중일 때 좌하단 Agents 에 세션명 + 아래 작은 글씨로 하는 일 |
| 5 | `+` 로 새 Claude 탭 → 탭 이름 `Claude Code` / 탭을 끌면 점선 |
| 6 | 우상단 `+` → `ccd (Claude, 권한 확인 생략)` → 새 탭에서 `pwd`(또는 Claude 첫 화면의 폴더)가 **정한 폴더**(안 정했으면 공간 폴더). 다른 폴더 공간에서 눌러도 정한 폴더 / 다른 기기 공간에선 그 공간 폴더 |
| 7 | `Ctrl+N` → 지금 공간에 새 Claude 탭 **하나** (`Claude Code` 로 보임), 폴더는 6번과 같음 |
| 4·5·8 | 다른 세션에 있을 때 끝난(채운 점) 세션을 누름 → **계속 채운 점**(탭 점·공간 점도 그대로) → 다른 세션을 누르면 그때 빈 동그라미 |
| 8 | 좌상단 공간 줄 왼쪽 ▾ 누르면 세션 목록이 접히고(▸) 다시 누르면 펼쳐짐 — 이때 **선택된 공간은 안 바뀜** / 세션 줄 누르면 그 창으로 이동 / 앱 껐다 켜도 펼침·접힘 그대로 / 공간을 끌어 순서 바꾸기도 그대로 됨 / 세션 없는 공간엔 버튼 없음 / 세션 줄을 다른 공간 줄로 끌면 그 줄에 점선 → 놓으면 그 공간으로 넘어가고 대화가 그대로 이어지며 탭 이름도 그대로 / 다시 원래 공간으로 끌어 옮기기 / 목록 밖에 놓으면 취소 |

이 동작들은 SSH 나 `hc send` 로는 시험할 수 없고, 그 PC 앞에서 직접 눌러야 합니다.

## 상태 확인 · 되돌리기

- **`2_상태확인.bat`** — 아무것도 바꾸지 않고 지금 상태만 보여 줌
- **`3_되돌리기.bat`** — 전부 해제하고 기본 레이아웃(`main`)으로 돌아감. 복제본 파일은 남겨 둠(`mods\my-new-menu\` 만 지우고 `+` 버튼을 기본 메뉴로 되돌림)
- **완전 삭제** — 되돌리기 후 `%USERPROFILE%\.config\herdr-app\` 에서 `layouts\my-main.json`, `mods\my-agents\`, `mods\my-tabs\`, `mods\my-spaces\` 를 지움
- 화면이 망가졌을 때 비상 탈출: 앱에서 **`Ctrl+Alt+Shift+Esc`** (기본 화면으로 복귀)

## 알아 둘 점

- **기본 레이아웃·기본 mod 는 읽기 전용**입니다. 앱을 켤 때마다 원본으로 덮어쓰기 때문에 직접 고치면 안 되고, 이 묶음처럼 복제본을 고칩니다.
- **단축키가 mod 를 가리키면 앱이 그 mod 칸을 스스로 넣습니다.** 손으로 또 넣으면 두 번 동작합니다(그림 두 장). 설치 스크립트는 이를 감안해 중복이면 하나만 남깁니다.
- 이미지 붙여넣기 뒤 클립보드에는 그림 대신 PNG 파일이 남습니다(그림판에 바로 붙이기는 안 됨). 저장 위치 `C:\Users\Public\herdr-paste\`, 하루 지나면 자동 삭제. 다른 기기(원격) 창은 손대지 않습니다.
- `ccd` 새 탭(6·7번)은 **설치 때 `--ccd-folder` 로 정한 폴더**(없으면 공간 폴더, 원격 공간은 늘 공간 폴더)에서 열립니다 — 위 「ccd 폴더」. (PowerShell 의 `ccd` 함수를 직접 부르지 않는 이유: herdr 는 bash/zsh 함수만 설치 확인을 해서 PowerShell 함수는 "not installed" 로 보일 수 있음)
- `+` 메뉴는 기본 `new-menu` 를 복제한 `my-new-menu` 입니다(programs.json 의 `run` 엔 폴더 칸이 없어서). 4·5·8번처럼 설치할 때마다 원본에서 다시 만듭니다.
- **Ctrl+N 은 앱이 먼저 받습니다**(터미널 안에서도). 그래서 터미널 프로그램 쪽 Ctrl+N(Claude 입력 기록 아래로 이동 등)은 못 씁니다 — 기록 이동은 방향키 ↓ 로. 원래 단축키 설정은 `keys.json.bak-ccdkey` 로 백업됩니다. Ctrl+N 이 이미 다른 동작에 걸려 있으면 설치가 멈추고 알려 줍니다.
- `Ctrl+Shift+V` 가 원래 하던 글자 붙여넣기는 그대로 됩니다(클립보드가 글자일 때). 원래 단축키 설정은 `keys.json.bak-imagepaste` 로 백업됩니다.
- 좌하단 Agents 에 안 보이는 Claude 탭이 있으면: 백그라운드로 돌던 세션을 `/resume` 으로 연 경우입니다 → `claude stop <id>` 후 그 탭에서 `claude --resume`.
- `Alt+위/아래` 는 Agents 목록 순서, `Ctrl+PageUp/PageDown` 이 상단 탭 순서입니다(버그 아님).

## herdr 업데이트 후

커스텀은 **날아가지 않고** 업데이트도 정상 적용됩니다(업데이트가 덮어쓰는 건 기본 파일뿐). 4·5·8번 복제본(my-agents·my-tabs·my-spaces)은 설치할 때마다 새 기본 mod 에서 다시 만들어지므로, `1_설치.bat` 을 한 번 더 돌리면 새 버전의 기본 화면 개선도 들어옵니다. 복제본 `main.js` 를 손으로 고친 내용은 그때 사라지니, 고칠 땐 `scripts\` 의 설치 스크립트를 고치세요.

1. `2_상태확인.bat` — 오류 없고 화면 정상이면 **할 일 없음**.
2. 새 버전의 탭 바·Agents·Spaces 개선을 받고 싶거나 화면이 깨졌으면:
   1. 앱에서 `Ctrl+Shift+L` 로 `main` 레이아웃으로 전환 (또는 `Ctrl+Alt+Shift+Esc`)
   2. `%USERPROFILE%\.config\herdr-app\` 의 `layouts\my-main.json`, `mods\my-agents\`, `mods\my-tabs\`, `mods\my-spaces\` 를 다른 폴더로 옮김(백업)
   3. `1_설치.bat` 다시 실행 → 새 버전을 다시 복제하고 수정만 다시 얹음
- 기본 mod 코드가 크게 바뀌면 스크립트가 **"고칠 문장을 못 찾음"** 으로 멈춥니다(엉뚱하게 고친 채로 남지 않음). 그때는 `scripts\install_agents_name_only.py` / `install_tabs_agent_name.py` / `install_ccd_button.py` / `install_spaces_tree.py` 의 `PATCHES` 를 새 코드에 맞춰야 합니다.

## 폴더 구성

```
herdr-custom/
├── 1_설치.bat / 2_상태확인.bat / 3_되돌리기.bat   더블클릭용 (setup.py 실행)
├── setup.py                       일괄 설치·점검·되돌리기
├── scripts/
│   ├── install_title_sync.py       2 (+ 1 레이아웃 복제)   --remove 로 개별 해제
│   ├── install_image_paste.py      3
│   ├── install_agents_name_only.py 4
│   ├── install_tabs_agent_name.py  5
│   ├── install_ccd_button.py       6 (+ my-new-menu)
│   ├── install_ccd_key.py          7
│   ├── ccd_folder.py               6·7 공용: --ccd-folder 읽기·설치본 값 유지·프로필 ccd 함수 찾기
│   ├── done_hold.py                4·5·8 공용: '끝남'을 다른 세션 누를 때까지 끝남으로 보이기
│   ├── install_spaces_tree.py      8
│   └── patchlib.py                 4·5·6·8 공용: 원본 mod 에서 다시 고쳐 복제본 덮어쓰기
├── tests/                          ccd_folder·done_hold 테스트 (python -m pytest tests)
└── assets/
    ├── title-sync/                 mod 원본 (main.js, mod.json)
    ├── image-paste/                mod 원본 + clipimg.cs (설치 때 빌드)
    └── ccd-key/                    Ctrl+N 을 받아 새 탭을 여는 mod
```


2026-11-04, herdr-core 0.1.16 기준으로 만들고 0.1.17 에서 확인함. 8번은 2026-11-05 herdr-app 0.1.13 에서 시험 적용으로 확인함.
