# 데스크톱 앱 커스텀 — 구현 메모 (스크립트·mod 를 고칠 때만)

쓰거나 깔 때는 `SKILL.md` 2갈래와 `README.md` 만 보면 된다. 여기는 설치 스크립트·mod 코드를 고치거나,
앱 업데이트로 `고칠 문장 못 찾음` 이 나왔을 때 보는 곳이다.

## 원본에서 다시 고치기 (patchlib, 0.3.0~)

- my-agents·my-tabs·my-spaces(와 ccd-button 의 my-new-menu)는 기본 mod 코드의 문장을 찾아 고친다. **적용할 때마다 원본 `mods/<기본>/main.js` 에서 처음부터 다시 고친 내용을 만들고, 복제본과 다를 때만 덮어쓴다**(`scripts/patchlib.py`).
- 복제본을 손으로 고쳤으면 상태가 `손으로 고친 흔적` 이 되고 `--force` 없이는 덮지 않는다(덮을 땐 백업) → 계속 쓸 수정이면 설치 스크립트를 고친다.
- 덮어쓸 때 `mod.clone` 처럼 자기 이름 참조(`mods/tabs/…` 아이콘, `openOverlay({ mod: "agents" })`)를 복제본 이름으로 바꾸고, 줄바꿈은 원본(CRLF)을 따른다 — 안 하면 아이콘·팝업이 원본 mod 를 가리킨다.
- 앱 업데이트로 문장이 바뀌면 "고칠 문장을 못 찾음" 으로 멈춘다(엉뚱하게 고친 채 남지 않음) → 그 스크립트의 `PATCHES` 를 새 원본에 맞춘다. 원본에서 다시 만들기 때문에 앱 업데이트의 화면 개선도 설치를 다시 돌리면 들어온다.
- my-spaces 앵커: 원본 spaces `main.js` 에 `this.refreshMachines(cx);` 가 **2번** 나와 앵커로 못 쓴다 → 15000 타이머 줄(`cx.timer.every(15000, …)`)을 앵커로 쓴다. 앱 판마다 원본 문장이 달라(0.1.11 은 공간을 번호 `i`, 0.1.13 은 `w.id` 로 다룸) 몇 패치는 대안 문장을 둔다.

## my-spaces — 다른 공간으로 옮기기

- **앱엔 탭을 다른 공간으로 옮기는 명령이 없다**(`tab.move` 는 같은 공간 안 순서만).
- 순서: `space.select`(대상) → `terminal.park`(창만 떼고 계속 실행, 빈 원래 탭은 앱이 지움) → `terminal.keep {place:"tab"}`(선택된 공간에 새 탭) → keep 탭 이름이 터미널 주소(t18 등)가 되므로 원래 이름이면 `tab.rename` 으로 복원. 이름 없던 탭은 `tab.rename` 빈 이름으로 되돌린다(안 하면 `t18` 이 남는다).
- mod 의 `run()` 은 null 을 돌려줘 새 탭 id 를 못 받는다 → `cx.sleep` 으로 기다리며 `panes()` 에서 그 터미널의 pane·tab 을 찾는다.
- **park 가 끝나기 전에 keep 이 들어가면 keep 이 안 먹어 창 없는 세션이 된다**(계속 돌지만 화면에서 사라짐) → 원래 창이 떨어질 때까지(최대 8초) 기다린 뒤 keep, 끝내 안 떨어지면 옮기기를 취소하고 알림(원래 창에 그대로라 잃은 것 없음).
- keep 은 3초씩 최대 3번, **늦게라도 붙었으면 다시 보내지 않는다**(같은 세션 탭이 둘 생기지 않게). 끝내 못 붙이면 원래 공간에 되돌려 붙이고 알림. 대기 시간·횟수는 mod 위쪽 `MOVE_*` 상수.
- **끌기 상태가 남으면 나중 클릭에 세션이 옮겨진다**(0.2.x 버그): 세션 줄을 누른 채 목록 밖이나 ▾/▸ 위에서 놓으면 끌기 상태가 안 지워졌다. mod 의 `on_mouse_move` 는 버튼 눌림을 알려 주지 않는다 → 목록 밖으로 나감(`on_hover` false)·밖을 누름(`on_mouse_down_out`)·공간 줄 새로 누름·▾/▸ 에서 놓음에서 모두 끌기를 지운다.

## my-spaces — 빈 공간 남기기 (0.5.x)

- **앱엔 빈 공간이 없다**(공간엔 탭이 1개 이상, 마지막 탭을 닫으면 공간도 닫힘) → my-spaces 가 사라진 공간을 기억해 흐린 빈 줄로 그린다(0.5.0).
- 기억하는 곳: my-spaces 의 localStorage `spaces.kept`(이 화면에만 — 다른 PC·웹엔 안 보임). 내용은 기기·이름·폴더(첫 터미널이 있던 곳)·색.
- 남기는 것: **탭이 딱 1개였다가 사라진, 이름 붙인 공간만.**
  - 탭 여러 개인 공간을 통째로 닫은 것·이미 비어 있던(탭 0개) 공간을 지운 것은 안 남긴다(0.5.1 — 웹에서 지운 빈 공간이 앱에 흐린 줄로 되살아나던 것).
  - 이름을 안 붙인 공간(`spaces()[i].named` 가 false — 화면엔 폴더 이름이나 `~`)은 안 남긴다(0.5.4, 잠깐 연 셸로 봄. 예전 판이 저장해 둔 이름 없는 줄은 다시 켤 때 버린다).
  - **안의 세션이 살아 있는데 어느 공간에도 없으면** 안 남긴다(0.5.3 — 공간만 지우는 도구로 일부러 지운 것). 사라진 뒤 `hc ls` 로 살아 있는지 보고, 끌어 옮기는 중일 수 있어 `KEPT_LOOSE_WAIT_MS` 10초까지 다시 본다. `hc ls` 를 못 읽으면 남기는 쪽.
  - SKILL.md 3갈래 서버 프로그램과 같은 규칙.
- 기기 연결이 끊겨 공간이 안 보이는 것과 구별하려고 사라진 뒤 1.5초 동안 그 기기 화면이 `ready` 인지 다시 본다.
- 빈 줄을 누르면 `space.new {name, folder, machine}` 으로 되살린다(새 id 라 색은 `space.colors` 에 옮겨 적음, 폴더가 없어져 실패하면 폴더 없이 한 번 더). 세션을 끌어 놓으면 되살린 뒤 옮기고 같이 생긴 셸 탭을 닫는다 — **탭이 2개로 보일 때만 닫는다**(1개일 때 닫으면 공간이 또 닫힘).
- 같은 기기에 같은 이름 공간이 생기면 빈 줄은 스스로 사라진다. 되살린 공간은 그 기기 목록 맨 끝에 붙는다(원래 자리 아님). 대기 시간은 mod 위쪽 `KEPT_*` 상수.
- 참고: 앱 문서에 `tabs: []` 공간을 직접 넣으면 앱이 지우지 않고 보통 공간처럼 보여 준다(서버 프로그램이 쓰는 방식).

## '끝남' 표시 늦추기 (done-hold, 0.7.0)

- 앱 본체는 done 세션을 **보는 순간** idle 로 바꾼다(seen.json — mod 로 못 바꿈). 그래서 my-agents·my-tabs·my-spaces 복제본은 **표시만** 늦춘다.
- `scripts/done_hold.py` 가 mod 안의 `agents()`·`spaces()` 부름을 `shownAgents()`·`shownSpaces()` 로 바꿔, 보고 있는 세션이 보기 직전에 done 이었으면 그 세션·탭·공간의 idle 을 done 으로 보여 준다. 다른 세션(또는 셸 창)을 누르거나 다시 일하기 시작하면 놓는다.
- 보는 중에 끝난 세션은 앱이 처음부터 idle 로 두므로 그대로 idle. 앱·엔진 상태·소리는 그대로이고, mod 마다 따로 계산한다(같은 규칙이라 답이 같음).
- 동작 시험: `python -m pytest desktop/tests`(node 있으면 JS 까지).

## 지금 하는 일(status.msg) 나눠 쓰기

my-agents 가 3초마다 `hc get` 으로 읽어 `shared("agent.msgs")` 로 내놓고, my-spaces 는 레이아웃에 my-agents 가 있으면 그걸 읽는다(없을 때만 직접 읽음) — 같은 조회를 두 번 돌리지 않게.

## ccd 폴더 (ccd-button·ccd-key)

- 앱 API `tab.new` 는 `folder` 를 받지만 programs.json 의 `run` 엔 폴더 칸이 없다 → `+` 메뉴는 기본 new-menu 를 my-new-menu 로 복제해 고치고(patchlib), `+` 버튼은 tabs mod 안에 있어서 my-tabs 가 `openOverlay({ mod: "my-new-menu" … })` 로 연다.
- **my-new-menu 가 있을 때만 그렇게 고친다**(없는데 가리키면 `+` 가 아무것도 안 엶) → setup 순서는 ccd 버튼 → my-tabs, ccd-button 설치·`--remove` 뒤엔 my-tabs 를 다시 맞춘다(`refresh()`). my-new-menu 는 팝업이라 레이아웃 칸이 없다. `KNOWN`("new-menu.agents") 캐시 키는 원본과 같이 쓴다.
- 원격 공간은 늘 그 공간 폴더: `spaces()[i].machine` 이 null 일 때만 정한 폴더를 쓴다(이 PC 경로는 원격에 없음).
- PowerShell `ccd` 함수를 부르지 않는 이유: herdr 는 bash/zsh 함수만 설치 확인을 해서 PowerShell 함수는 "not installed" 로 보임 → 탭은 늘 `claude` 를 직접 실행.
- 폴더 정하는 순서(`scripts/ccd_folder.py`): ① 옵션 ② **설치본 값 유지**(ccd-key `const FOLDER`, my-new-menu `const CCD_FOLDER` 줄 — 안 그러면 setup 을 다시 돌릴 때마다 폴더가 사라짐, `""` 로 해제해 둔 것도 유지) ③ 설치본에 그 줄이 없을 때만 PowerShell 프로필의 `function ccd { Set-Location "<경로>" … }`(프로필 위치는 `$PROFILE` 을 powershell·pwsh 에 물어봄 — OneDrive 문서 폴더 대비. `cd`·`-Path`·변수·`Push-Location` 등 다른 형식이면 조용히 건너뜀) ④ `""`.
- 설치 때 폴더가 없으면 경고하고 `""`(없는 폴더로 `tab.new` 하면 탭이 안 열림), `claude` 가 PATH 에 없으면 경고(`+` 메뉴는 "not installed" 로 흐림, Ctrl+N 은 오류 알림). 상태표 아래 `ccd 폴더: …` 줄, 두 설치본 값이 다르면 경고.
- 설치 뒤 폴더가 지워진 경우: mod 가 누를 때 `exec("cmd", ["/c","exit"], {cwd})` 로 확인(`exec` 는 cwd 가 없으면 거절)하고, 없으면 공간 폴더로 열고 `notify` 로 알린다. `run()` 은 null 이라 tab.new 실패를 직접 알 수 없어서다. `+` 메뉴는 메뉴를 열 때 미리 확인하고 결과가 오기 전에 누르면 폴더를 믿고 넘긴다. **이 확인은 실제로 시험해 보지 않았다**(폴더 지정 자체는 2026-11-11 herdr-app 에서 확인됨).

## 그림 붙여넣기 (image-paste)

앱은 Windows 로컬 창에 클립보드 **글자만** 붙인다. mod 가 `clipimg.exe`(설치 때 .NET Framework 4 `csc.exe` 로 빌드, 인터넷 안 씀)로 그림을 `C:\Users\Public\herdr-paste\paste-*.png` 에 저장하고 클립보드를 '복사한 파일'로 바꾼 뒤 `terminal.paste` → 경로가 들어가고 Claude 가 그림으로 읽는다. 원격 창이면 바로 `terminal.paste`(앱이 그림을 그 기기로 복사). Claude 자체 Alt+V 는 PowerShell 을 띄워 느려서 안 쓴다.
