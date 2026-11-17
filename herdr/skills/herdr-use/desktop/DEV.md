# 데스크톱 앱 커스텀 — 구현 메모 (스크립트·mod 를 고칠 때만)

쓰거나 깔 때는 `SKILL.md` 2갈래와 `README.md` 만 보면 된다. 여기는 설치 스크립트·mod 코드를 고치거나,
앱 업데이트로 `고칠 문장 못 찾음` 이 나왔을 때 보는 곳이다.

## 원본에서 다시 고치기 (patchlib, 0.3.0~)

- my-agents·my-tabs·my-spaces(와 ccd-button 의 my-new-menu)는 기본 mod 코드의 문장을 찾아 고친다. **적용할 때마다 원본 `mods/<기본>/main.js` 에서 처음부터 다시 고친 내용을 만들고, 복제본과 다를 때만 덮어쓴다**(`scripts/patchlib.py`).
- 복제본을 손으로 고쳤으면 상태가 `손으로 고친 흔적` 이 되고 `--force` 없이는 덮지 않는다(덮을 땐 백업) → 계속 쓸 수정이면 설치 스크립트를 고친다.
- 덮어쓸 때 `mod.clone` 처럼 자기 이름 참조(`mods/tabs/…` 아이콘, `openOverlay({ mod: "agents" })`)를 복제본 이름으로 바꾸고, 줄바꿈은 원본(CRLF)을 따른다 — 안 하면 아이콘·팝업이 원본 mod 를 가리킨다.
- 앱 업데이트로 문장이 바뀌면 "고칠 문장을 못 찾음" 으로 멈춘다(엉뚱하게 고친 채 남지 않음) → 그 스크립트의 `PATCHES` 를 새 원본에 맞춘다. 원본에서 다시 만들기 때문에 앱 업데이트의 화면 개선도 설치를 다시 돌리면 들어온다.
- 앱 0.1.16(2026-11-16 기본 mod 갱신): tabs 의 이름 줄이 `const name = label(c, lead);` 로 바뀌었다(원본이 이미 이름 없는 탭에 프로그램 이름·에이전트 실시간 제목을 보임) → 그 패치는 같은 문장으로 바꾸는 대안(= 그대로 둠). spaces 는 `rows.map(draw)` 줄이 if/return 으로 나뉘고 **활성 공간으로 스크롤**(`this.activeAt`, 원격 기기 갈래는 `const first`)이 생겼다. 이 값은 목록 **자식 몇 번째**라, my-spaces 가 공간마다 [공간 줄, ...세션 줄] 을 펼치면 어긋난다 → `drawnSpan(w, collapsed)`(draw 와 같은 개수 규칙) 합으로 다시 센다. 원격 갈래 패치는 옛 원본엔 문장이 없어 '바로 앞 패치가 만든 줄'을 그대로 두는 대안을 둔다(옛·새 원본 모두 멈추지 않음). 시험: `tests/test_app_0116.py`(activeAt 계산은 node 로, 실제 원본은 `HERDR_MOD_SRC` 를 줄 때만).
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

## ccd 폴더 (ccd-button)

- 앱 API `tab.new` 는 `folder` 를 받지만 programs.json 의 `run` 엔 폴더 칸이 없다 → `+` 메뉴는 기본 new-menu 를 my-new-menu 로 복제해 고치고(patchlib), `+` 버튼은 tabs mod 안에 있어서 my-tabs 가 `openOverlay({ mod: "my-new-menu" … })` 로 연다.
- **my-new-menu 가 있을 때만 그렇게 고친다**(없는데 가리키면 `+` 가 아무것도 안 엶) → setup 순서는 ccd 버튼 → my-tabs, ccd-button 설치·`--remove` 뒤엔 my-tabs 를 다시 맞춘다(`refresh()`). my-new-menu 는 팝업이라 레이아웃 칸이 없다. `KNOWN`("new-menu.agents") 캐시 키는 원본과 같이 쓴다.
- 원격 공간은 늘 그 공간 폴더: `spaces()[i].machine` 이 null 일 때만 정한 폴더를 쓴다(이 PC 경로는 원격에 없음).
- PowerShell `ccd` 함수를 부르지 않는 이유: herdr 는 bash/zsh 함수만 설치 확인을 해서 PowerShell 함수는 "not installed" 로 보임 → 탭은 늘 `claude` 를 직접 실행.
- 폴더 정하는 순서(`scripts/ccd_folder.py`): ① 옵션 ② **설치본 값 유지**(my-new-menu `const CCD_FOLDER` 줄 — 안 그러면 setup 을 다시 돌릴 때마다 폴더가 사라짐, `""` 로 해제해 둔 것도 유지) ③ 설치본에 그 줄이 없을 때만 PowerShell 프로필의 `function ccd { Set-Location "<경로>" … }`(프로필 위치는 `$PROFILE` 을 powershell·pwsh 에 물어봄 — OneDrive 문서 폴더 대비. `cd`·`-Path`·변수·`Push-Location` 등 다른 형식이면 조용히 건너뜀) ④ `""`.
- 설치 때 폴더가 없으면 경고하고 `""`(없는 폴더로 `tab.new` 하면 탭이 안 열림), `claude` 가 PATH 에 없으면 경고(`+` 메뉴는 "not installed" 로 흐림). 상태표 아래 `ccd 폴더(+ 메뉴): …` 줄.
- 설치 뒤 폴더가 지워진 경우: mod 가 누를 때 `exec("cmd", ["/c","exit"], {cwd})` 로 확인(`exec` 는 cwd 가 없으면 거절)하고, 없으면 공간 폴더로 열고 `notify` 로 알린다. `run()` 은 null 이라 tab.new 실패를 직접 알 수 없어서다. `+` 메뉴는 메뉴를 열 때 미리 확인하고 결과가 오기 전에 누르면 폴더를 믿고 넘긴다. **이 확인은 실제로 시험해 보지 않았다**(폴더 지정 자체는 2026-11-11 herdr-app 에서 확인됨).

## 그림 붙여넣기 (image-paste)

앱은 Windows 로컬 창에 클립보드 **글자만** 붙인다. mod 가 `clipimg.exe`(설치 때 .NET Framework 4 `csc.exe` 로 빌드, 인터넷 안 씀)로 그림을 `C:\Users\Public\herdr-paste\paste-*.png` 에 저장하고 클립보드를 '복사한 파일'로 바꾼 뒤 `terminal.paste` → 경로가 들어가고 Claude 가 그림으로 읽는다. 원격 창이면 바로 `terminal.paste`(앱이 그림을 그 기기로 복사). Claude 자체 Alt+V 는 PowerShell 을 띄워 느려서 안 쓴다.

## 탭 x 두 번 눌러 닫기 (my-tabs close-confirm, 0.9.0)

- 원본 tabs 의 x 는 `on_click` 에서 바로 `run("tab.close")`. my-tabs 패치가 `this.closeArm`(준비된 탭 id)·`closeArmAt` 을 두고, 첫 클릭엔 준비만(빨간 바탕 `CLOSE_ARMED_BG`), `CLOSE_ARM_MS`(3초) 안의 두 번째 클릭에 닫는다.
- 원본 `init()` 엔 cx 가 없어 `init(_props, cx)` 로 바꾸고 `cx.timer.every(CLOSE_TICK_MS, …)` 로 시간이 지나면 준비를 풀고 다시 그린다(spaces mod 와 같은 방식).
- 상수는 mod 맨 위 `[herdr-use close-confirm]` 줄 아래.

## 종료된 Claude 세션 일괄 이어하기 (resume-all, 0.9.2)

- 재부팅·로그아웃·core 재시작으로 잃은 터미널은 같은 주소·이름표로 **셸만** 다시 뜬다(앱 AGENTS.md: 원래 명령은 다시 안 돌림). 플러그인 훅 `hooks/label_session.py` 가 붙인 `claude.session`(UUID)·`claude.project` 이름표는 남는다(재부팅 전 세션 id 그대로인 것 확인).
- 구성: 팝업 mod `assets/resume-all/`(place none, dialog — 레이아웃 칸 없음) + my-tabs 의 `Resume` 버튼(`install_tabs_agent_name.py` 의 `RESUME_PATCHES`). 버튼은 **`mods/resume-all/main.js` 가 있을 때만** 넣는다(없는데 버튼만 있으면 눌러도 아무것도 안 뜸) → setup 순서 resume-all → my-tabs, `install_resume_all.py` 설치·`--remove` 뒤엔 `refresh()` 로 my-tabs 를 다시 맞춘다. `terminals` import 는 `ensure_imports` 로 넣는다(done-hold 가 `agents` 를 덧붙이므로 import 줄을 문장으로 패치하지 않음).
- **후보 규칙이 두 곳에 있다** — my-tabs `resumableCount()` 와 resume-all `resumableTerminals()`(mod 끼리 import 불가). 한쪽만 고치면 버튼 숫자와 팝업 목록이 어긋난다 → `tests/test_resume_all.py::test_candidate_rule_matches_popup` 가 잡는다. 규칙: `state === "live"` · 주소에 `/` 없음(이 PC) · `!t.status && !t.program?.agent` · 두 이름표가 엄격한 패턴 · `panes()` 에 창이 있음.
- 기록 읽기 `read_sessions.ps1`(읽기만): `$env:CLAUDE_CONFIG_DIR\projects` → `~\.claude\projects` 순으로 `<project>\<id>.jsonl` 을 한 번 훑는다. `cwd` = 처음 나오는 `"cwd"`, `last` = 마지막 assistant 줄(`{"parentUuid"` 로 시작 + `"role":"assistant"`)의 `timestamp`(없으면 파일 수정 시각으로 표시), 권한 모드 = `{"type":"permission-mode"…}` 줄 **과** user 줄의 최상위 `permissionMode`(도구 출력 속 같은 글자에 속지 않게 user 줄은 JSON 으로 파싱). 6MB 기록 약 2초. 입력 `-In "<id>:<project>,…"` 는 양쪽 다 패턴 검사(base64 안 씀).
- PowerShell 5.1 함정: `... | ConvertFrom-Json` 은 배열을 한 덩어리로 감싼다 → 파이프 말고 `-InputObject`.
- 권한 옵션: 기록에 `bypassPermissions` 가 **한 번이라도** 있으면 `--dangerously-skip-permissions`(그 플래그로 시작해야만 들어가는 모드). 아니면 마지막 모드가 `acceptEdits`/`auto`/`dontAsk`/`plan` 이면 `--permission-mode <값>`, 그 밖(`default`/`manual`/없음)은 옵션 없음(`claude --help` 의 choices 기준).
- 폴더: claude 는 기록 폴더(`claude.project` = 시작 폴더의 영숫자 외 문자를 `-` 로 바꾼 이름)와 맞는 폴더에서 열어야 기록을 찾는다 → 셸 cwd·기록의 첫 cwd 중 slug 가 맞는 쪽, 셸 cwd 와 다르면 앞에 `Set-Location -LiteralPath '<폴더>'; `(cmd 면 `cd /d "<폴더>" && `). 줄 만들기 `resumeLine()` 은 `tests/test_resume_all.py` 가 node 로 확인.
- 보내기: mod 의 `hc(["send", 주소, 줄])`. 앱 프로세스엔 `HC_TERMINAL_ID` 가 없어 `<hc from>` 태그로 안 감싸진다(셸에 그대로 입력됨 확인). 오버레이가 닫히면 진행 중인 호출이 취소될 수 있어 **전부 보낸 뒤** `closeOverlay`.
- 원격 기기는 뺐다: 그쪽엔 이름표 훅이 안 돌았고 읽기 스크립트가 PowerShell 이다. 넣으려면 `exec(..., { on: machine })` + POSIX 판 읽기 스크립트.
- 시험: 2026-11-17 사용자 PC(herdr-app 0.1.16, 플러그인 0.9.1 위 손 적용)에서 `hc server stop` → `start` 뒤 여러 세션을 한 번에 이어하는 것까지 사용자가 확인. 플러그인판(0.9.2) my-tabs 패치는 서버에 앱 원본이 없어 가짜 원본으로만 시험했다 → PC 에서 `setup.py --apply resume-all,my-tabs --force` 뒤 `herdr-app check` 로 확인.

## 예전 ccd-key (0.9.0 에 뺌)

Ctrl+N 을 mod(`ccd-key.new`)가 받아 `tab.new {argv: claude --dangerously-skip-permissions}` 로 열었다. mod 파일을 다시 쓰거나 앱을 오래 켜 두면 키가 안 닿는 일이 잦아 뺐다. `install_newtab_key.py` 가 단축키(`ccd-key.new`)·레이아웃 칸·`mods/ccd-key/` 를 치우고 Ctrl+N 을 앱 자체 `tab.new` 로 건다. **키를 먼저 옮기고 칸을 뺀다** — 단축키가 mod 를 가리키는 동안엔 앱이 칸을 스스로 다시 넣는다.
