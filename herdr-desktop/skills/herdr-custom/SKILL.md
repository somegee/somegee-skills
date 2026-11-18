---
name: herdr-custom
description: herdr 데스크톱 앱(Windows)을 만든 사람(somegee) 세팅 그대로 맞추는 커스텀 설치 + 서버·웹 관제 연동. 인자 `내세팅`(=mine·전부)이면 묻지 않고 모든 기능 + 앱 설정을 한 번에 깔고, `설치`(=install·커스텀)면 기능을 골라 깔고, `상태`(=status)면 상태표만. 기능 — 내 레이아웃 복제 + /rename → 탭 이름, Ctrl+Shift+V 그림 붙여넣기, Agents 목록 세션명만, 탭 「Claude Code」·점선·x 두 번 눌러 닫기, Ctrl+N 새 터미널 탭, Spaces 공간별 세션 펼치기·끌어 옮기기·빈 공간 남기기, 우상단 Resume(재부팅 뒤 Claude 세션 일괄 이어하기), 앱 설정(어두운 화면·통계 끔). 서버 쪽은 탭 이름 동기화·빈 공간 되돌리기(herdr-title-sync), '끝남/봤음' 이름표, 세션 이름표 훅. herdr 자체 사용법(hc 명령·연결)은 다루지 않는다 — `hc --help`·`herdr-app --help`를 본다. '새 PC에 내 herdr 세팅 깔아줘', 'herdr 내 세팅 그대로', 'herdr 커스텀 깔아줘', 'herdr 커스텀 상태', '플러그인 올렸으니 커스텀 맞춰줘', 'rename 하면 탭 이름 바뀌게', 'herdr 그림 붙여넣기', 'Ctrl+N 새 탭', '탭 x 바로 닫힘', 'Spaces 세션 펼치기', '재부팅 뒤 세션 한 번에 이어하기', 'herdr 탭 이름 동기화' 요청 시 사용.
argument-hint: "[내세팅|설치|상태]"
---

# herdr-custom — herdr 데스크톱 앱을 내 세팅으로 + 서버 연동

> herdr 자체 사용법(`hc` 명령, machine add, 연결)은 여기 적지 않는다 — `hc --help`, `hc <명령> --help`, `herdr-app --help`, `herdr-app commands`가 원천이다. 여기엔 **커스텀(앱 mod·레이아웃·키·설정)과 그 함정**만 있다.
> 서버 재설치 때 herdr 관련 손볼 것(PATH, 환경변수 물려받기, 서버 → PC SSH)은 `homeserver-recovery` 3.8b, 웹 서버 터미널의 `hc run` 이름표는 `somegee-front-dev`에 있다(2026-11-18 옮김).

## 이 스킬의 파일 찾기

플러그인 설치본은 버전마다 폴더가 바뀐다. 최신 폴더를 이렇게 찾는다(`sort -V` 필수 — 그냥 `ls`는 글자 순서라 0.10.0보다 0.9.x를 고른다):

```bash
K="$(ls -d ~/.claude/plugins/cache/*/herdr-desktop/*/skills/herdr-custom 2>/dev/null | sort -V | tail -1)"
```

## 인자로 불렸을 때 (`/herdr-desktop:herdr-custom <인자>`)

인자가 없거나 아래에 없는 말이면 이 절은 건너뛰고 요청에 맞는 절로 간다. **Windows PC(앱이 있는 곳)에서만 한다** — `herdr-app`이 없는 곳(서버 등)이면 "앱이 있는 PC 세션에서 다시 불러 주세요"라고만 하고 끝낸다.

- **`내세팅`(`mine`·`전부`·`내 세팅 그대로`)**: 새 PC나 앱을 다시 깐 뒤 만든 사람 세팅을 그대로 옮긴다. 기능마다 묻지 않는다.
  1. `python "$K/desktop/setup.py" --choices --json`을 읽는다(아무것도 안 바꿈). `app` 줄에 `10061`·`못 찾음`이면 앱을 트레이까지 끄고 다시 켜 달라고 하고 멈춘다.
  2. 기능은 묻지 않고, **AskUserQuestion 한 번**에 아래만 묻는다: ① 레이아웃(아래 「레이아웃 질문」 항목) ② `hand-edited`인 기능이 있을 때만: 덮을지(덮으면 `--force`).
  3. `python "$K/desktop/setup.py" --mine --layout "<고른 이름>" [--force]` — 모든 기능(레이아웃 복제 → mod → 키 → 앱 설정 순서)을 깐다. 최신인 건 안 건드린다.
  4. 1-3의 5·6단계(검증, 「사람이 눌러 볼 것」 전하기). 서버와 이어 쓸 PC면 2갈래(서버 쪽)도 깔려 있는지 한 줄 알린다.
  - "내 세팅"에 들어가는 것 = 1-1 표의 기능 전부. 2026-11-18 만든 사람 PC를 재 보니 쓰던 레이아웃(`somegee`)은 기본 `main` + 기능 칸뿐이라(구조 차이 없음) 기능을 다 깔면 같은 화면이 된다(이름만 `my-main`). 공간 이름·색, 연결한 기기, 창 위치는 사람마다 달라 옮기지 않는다.
  - 세팅을 새로 바꿨다면(설정 항목·키·레이아웃 칸) 그걸 기능으로 넣어야 "내 세팅"에 들어간다 — `install_app_settings.py`의 `WANTED`에 항목을 더하거나 새 기능 스크립트를 만든다.
- **레이아웃 질문** (`내세팅`·`설치` 공통, `--choices --json`의 `layout`을 보고 만든다 — 머리표 `레이아웃`, 단일 선택):
  - `shown`이 기본 레이아웃이 아니면(`shown_is_shipped: false`): 「지금 쓰는 `<shown>`에 얹기」를 첫 선택지로, `(추천)`.
  - `own`의 다른 내 레이아웃: 「`<이름>`에 얹기」(많으면 앞의 2개만 — 선택지 4개 한도).
  - 「새 레이아웃 `my-main` 만들기」 — `own`에 `my-main`이 이미 있으면 이 선택지는 빼고 Other(직접 입력)로 새 이름을 받게 질문 문장에 적는다. `shown`이 기본 레이아웃이면 이게 `(추천)`.
  - 고른 이름을 `--layout`으로 넘긴다. 있는 이름이면 거기로 전환해 얹고, 없는 이름이면 기본 `main`을 복제해 새로 만든 뒤 얹는다. 새 레이아웃은 기능 칸만 있는 깨끗한 판이라, 쓰던 레이아웃에 손으로 넣은 칸은 안 따라온다(쓰던 것은 그대로 남고 `Ctrl+Shift+L`로 돌아갈 수 있다).
  - 기본 레이아웃 이름(`main`·`terminals`·`win98`)은 못 쓴다(앱이 시작할 때 원본으로 되돌림) — 직접 입력으로 들어오면 다시 묻는다.
- **`상태`(`status`)**: `python "$K/desktop/setup.py" --status` 결과를 기능별 한 줄로 전한다. 아무것도 안 바꾼다.
- **`설치`(`install`·`커스텀`·`세팅`)**: 아래 순서. 1-3 행동 가이드의 규칙(최신은 안 건드림, 손으로 고친 흔적은 멈춤)은 그대로다.
  1. `python "$K/desktop/setup.py" --choices --json`을 읽는다(아무것도 안 바꿈). `app` 줄에 `10061`·`못 찾음`이 있으면 앱을 트레이까지 끄고 다시 켜 달라고 하고 멈춘다.
  2. **AskUserQuestion 한 번**에 `groups`마다 질문 하나 + 맨 끝에 레이아웃 질문 하나(위 「레이아웃 질문」 항목, 단일 선택 — 질문은 모두 4개 이하). 기능 질문은 (`multiSelect: true`, 머리표 = `title`). 선택지 이름 = `label`, 설명 = `state_label`(낡음이면 `detail` 요약) + `desc` 한 줄. `recommended`면 이름 끝에 `(추천)`. `state`가 `patch-missing`·`error`인 기능은 선택지에서 빼고 질문 문장에 "○○는 지금 깔 수 없음(이유)"로 적는다. 묶음의 선택지가 2개 미만이 되면 그 질문은 빼고 남은 묶음에 덧붙이지 않는다(질문당 4개 한도).
  3. 고른 기능의 `needs`가 안 골렸으면 더한다(`resume-all`의 버튼은 `my-tabs` 안에 있다). 더한 것은 한 줄로 알린다. 아무것도 안 골랐으면 끝낸다.
  4. 고른 것 중 `hand-edited`가 있으면 어떤 파일인지 알리고 덮을지 묻는다(덮으면 `--force`, 아니면 그 기능은 뺀다).
  5. `python "$K/desktop/setup.py" --apply <이름,…> --layout "<고른 이름>" [--force]` → 1-3의 5·6단계(검증, 「사람이 눌러 볼 것」 전하기).

---

# 1갈래. 데스크톱 앱 커스텀 (Windows) — `$K/desktop/`

기능 9개(+레이아웃 복제)를 **기능별로** 보고 고른 것만 깐다(0.8.0~). 원본 mod 문장 찾아 패치·CRLF·자기 이름 바꾸기·칸 중복 정리 같은 기계적인 일은 스크립트가 하고, **언제 무엇을 돌릴지는 1-3 행동 가이드대로 에이전트가 정한다.** 최신인 기능을 다시 쓰는 일은 하지 않는다(`--mine`도 낡음·없음인 것만 쓴다) — 안 바뀐 mod 파일을 다시 쓰면 그 직후 Ctrl+N이 한동안 안 먹었다(0.5.4·0.7.0·0.7.2 재적용 때, 원인은 "mod 파일을 다시 쓰면 앱이 mod를 다시 띄우는 사이 키가 안 닿음"으로 **추정**, 미검증).

- 고르는 화면으로 깔기: `/herdr-desktop:herdr-custom 설치`(맨 위 「인자」 절, 0.10.0). 묶음·추천·함께 필요한 기능은 `setup.py --choices --json`이 낸다 — 기능을 더하면 `setup.py`의 `GROUPS`·`SHORT`(·`NEEDS`)에도 넣는다(테스트가 빠뜨린 걸 잡음).
- 사람이 읽고 눌러 볼 것: `desktop/README.md`(「확인 방법」 표)
- 스크립트·mod를 고칠 때, `고칠 문장 못 찾음`이 나왔을 때: `desktop/DEV.md`(patchlib, 공간 옮기기·빈 공간·done-hold·그림 붙여넣기·resume-all 구현)

## 1-1. 기능

| 이름 | 기능 | 스크립트 |
|---|---|---|
| `title-sync` | 기본 레이아웃을 내 것(`my-<이름>`)으로 복제(나머지가 이 위에 얹힘) + `/rename`·Claude 자동 제목 → 상단 탭 이름 | `install_title_sync.py` |
| `image-paste` | Ctrl+Shift+V 그림 붙여넣기 (image-paste mod + `clipimg.exe`) — **키를 받는 mod** | `install_image_paste.py` |
| `my-agents` | 좌하단 Agents: 세션명만 + 작업 중이면 "지금 하는 일" | `install_agents_name_only.py` |
| `resume-all` | 우상단 `Resume` 버튼(Files 왼쪽, my-tabs 안) → 팝업: 재부팅·core 재시작 뒤 **셸만 남은 Claude 세션**을 골라 각 탭에 `claude --resume <id> [권한 옵션]` 입력(탭 자리·이름 그대로). 마지막 답변 시각·권한 모드 배지, 권한 옵션은 기록에서 자동 판별, 시작 폴더가 다르면 옮겨서 엶. 이 PC 터미널만(0.9.2) | `install_resume_all.py` |
| `my-tabs` | 상단 탭: 이름 없는 Claude 탭은 `Claude Code`(앱 0.1.16부터는 원본 `label()`이 프로그램 이름·Claude 실시간 제목을 보여서 그대로 둠) + 끌 때 점선 + **x는 두 번 눌러 닫기**(첫 번째엔 빨간 바탕, 3초 안에 한 번 더 — 0.9.0) + resume-all이 있으면 우상단 `Resume` 버튼(이어할 세션이 있으면 강조 + 개수) | `install_tabs_agent_name.py` |
| `newtab-key` | Ctrl+N → 앱 자체 `tab.new`(새 터미널 탭). mod 없이 keys.json 한 줄. 예전 `ccd-key`(Ctrl+N → ccd 새 Claude 탭, 키를 받는 mod)가 남아 있으면 치운다(0.9.0 — 키가 자주 안 먹어서 뺌) | `install_newtab_key.py` |
| `my-spaces` | 좌상단 Spaces: ▾/▸로 공간별 세션 목록 펼치기(앱 0.1.16의 활성 공간 자동 스크롤도 펼친 세션 줄만큼 맞춤) + 상태·하는 일, 누르면 그 창으로, 다른 공간으로 끌어 옮기기(같은 기기만), 같은 공간 안 순서 바꾸기(`tab.move`, 0.7.2), 세션 0개 공간을 빈 줄로 남기기 | `install_spaces_tree.py` |
| `app-settings` | 앱 설정 `settings.json`의 두 항목만: 어두운 화면(`appearance: dark`) + 사용 통계 안 보냄(`telemetry: false`). 되돌리면 적용 전 값 | `install_app_settings.py` |

my-agents·my-tabs·my-spaces는 '끝남' 세션을 눌러 봐도 끝남으로 보이다가 **다른 세션을 누를 때** '쉬는 중'으로 바꾼다(done-hold, 0.7.0 — 표시만 늦춤).

## 1-2. 명령 (`$K/desktop/`, 자세한 건 `setup.py --help`)

- `setup.py` = `--status` = `--check`: 전 기능 상태표. **아무것도 안 바꾼다**(앱이 꺼져 있어도 파일만 보고 나옴). `--json` 가능.
- `setup.py --dry-run [이름,…]`: 적용하면 쓸 파일(줄 수)·할 일. 아무것도 안 쓴다.
- `setup.py --apply`: 낡음·없음인 기능만. `--apply title-sync,my-spaces`: 고른 것만. **최신인 기능은 건드리지 않는다**(파일 시각도 그대로). 끝에 바뀐 기능 / 그대로인 기능 / 멈춘 기능 / 바뀐 파일 / 사람이 눌러 볼 것을 따로 보여 준다.
- 기능 하나: `scripts/install_<…>.py --status [--json]` / `--dry-run` / (옵션 없음 = 낡음·없음이면 적용) / `--force` / `--remove`.
- 상태: `최신` · `낡음(무엇이 다른지)` · `없음` · `손으로 고친 흔적` · `고칠 문장 못 찾음(앱 업데이트)` · `오류`. 기능 스크립트 `--status` 종료 코드 0 / 10 / 11 / 12 / 13 / 14.
- **손으로 고친 흔적**은 설치 기록으로 가린다: 스크립트가 mod 파일을 쓸 때마다 해시를 `~/.config/herdr-app/.herdr-custom/installed.json`에 적는다. 설치본이 플러그인판과도, 마지막으로 스크립트가 쓴 내용과도 다르면 손으로 고친 것. 기록이 없는 파일(0.7.x 이전 설치분)은 알 수 없어 `낡음(설치 기록 없음)`으로 나온다 — `--apply`를 한 번 돌리면 플러그인판과 같은 파일은 **mod 파일을 건드리지 않고 기록만** 남겨(모두 최신이어도), 그 뒤부터 가려진다(0.8.1). 섞인 파일(keys.json·programs.json·레이아웃)은 해당 항목만 본다.
- `--layout <이름>`(`--apply`·`--mine`·`--dry-run`과 함께): 얹을 레이아웃. 있는 이름이면 전환해 얹고, 없으면 `main`을 복제해 새로 만든다. 안 주면 지금 보이는 내 레이아웃(기본 레이아웃을 쓰는 중이면 `my-<이름>`으로 복제). 상태표의 `레이아웃:` 줄이 지금·얹힐 곳·내 레이아웃 목록이다.
- `setup.py --mine`: 모든 기능을 한 번에(= `--apply <전부>`, 최신은 안 건드림).
- `1_설치.bat` = `--apply`, `2_상태확인.bat` = `--status`, `3_되돌리기.bat` = 전부 `--remove`.

## 1-3. 에이전트 행동 가이드 — 커스텀을 깔거나 플러그인 업데이트 뒤 다시 맞출 때

1. **먼저 본다.** `python "$K/desktop/setup.py" --status`. 플러그인을 올린 뒤라면 이전 판과 바뀐 스크립트도 본다: `diff -rq <이전 판>/skills/herdr-custom/desktop "$K/desktop"`(이전 판 = `ls -d ~/.claude/plugins/cache/*/herdr-desktop/*/ | sort -V`에서 끝에서 두 번째). 앱 응답은 상태표 아래 `앱:` 줄(또는 `herdr-app status`) — `10061`이면 트레이까지 완전히 끄고 다시 켜라고 안내한다(복제본을 새로 만들거나 기본 레이아웃을 복제·전환할 땐 앱이 응답해야 함).
2. **사용자에게 보고하고 고르게 한다.** 기능마다 최신/낡음/없음과, 낡음이면 무엇이 달라지는지 한 줄(`--dry-run <이름>` 결과나 diff에서). **사용자가 고른 것만 적용한다.** "전부 맞춰"라고 하면 낡음·없음만(`--apply`).
3. **손으로 고친 흔적이면 멈춘다.** 사용자가 시험 적용 중인 것일 수 있다. 어떤 파일인지와 백업 위치(`~/.config/herdr-app/.herdr-custom/backup/<시각>/`)를 알리고 **확인을 받은 뒤에만** `--apply <이름> --force`. `고칠 문장 못 찾음`이면 적용하지 말고 그 스크립트의 `PATCHES`를 새 원본에 맞추는 일로 넘긴다(`DEV.md`).
4. **적용.** 고른 기능만: `setup.py --apply <이름,…>`(또는 그 기능 스크립트).
5. **검증.** 다시 `--status`로 고른 기능이 `최신`이 됐는지, 결과의 `바뀐 파일:`에 안 고른 기능의 파일이 없는지 본다(예외: resume-all은 `Resume` 버튼 연결을 맞추려고 my-tabs를 다시 만들 수 있음 — 결과에 따로 적힘). 앱 오류(`앱:` 줄의 오류, `herdr-app status`의 errors)도 본다.
6. **사람 확인으로 넘긴다.** 키·화면 동작은 에이전트가 시험할 수 없다. 결과의 「사람이 눌러 볼 것」(바뀐 기능만)을 그대로 전한다. **image-paste(Ctrl+Shift+V)처럼 키를 받는 mod를 다시 썼다면 "처음 한 번 안 먹으면 앱 창을 클릭하고 영문 상태에서 다시 누르기"를 같이 안내한다**(결과에 ※로 나옴).

- 에이전트가 직접 해도 되는 진단: `herdr-app do <명령>`으로 mod 명령을 보내 결과를 본다. 예: `herdr-app do tab.new` → 새 탭을 `hc get <t> --json`으로 보고 cwd·argv 확인 → 시험 탭은 `herdr-app do tab.close '{"id":"<탭 id>","confirmed":true}'`로 닫기. **키가 앱에 닿는지(사람)와 mod가 맞게 도는지(에이전트)를 이렇게 나눠 본다.**
- 이미 기본 레이아웃이 아닌 내 레이아웃(예: 직접 복제한 것)을 쓰는 중이면 **새로 복제하지 않고 그 레이아웃에 얹는다.**

## 1-4. 쓸 때 함정

- **`herdr-app do`/`status`가 `no Herdr window ... (os error 10061)`이면** 앱이 명령을 못 받는 상태다. 오래 떠 있던 앱 프로세스가 이러기도 한다 → 트레이까지 완전히 끄고 다시 켠다. SSH 세션에서도 같은 오류가 난다(앱 창에 못 붙음) → 원격에선 파일만 `hc file write --on pc`로 쓰고 레이아웃 전환은 사람이 한다. newtab-key(keys.json만 고침)는 앱 응답 없이도 깔리지만 my-agents·my-tabs·my-spaces(mod 복제 — 복제본이 아직 없을 때)와 기본 레이아웃 복제·전환은 앱이 응답해야 한다. 상태 확인(`--status`·`--dry-run`)은 앱 없이 된다.
- **기본 레이아웃·기본 mod는 읽기 전용이다.** 앱이 시작할 때 원본으로 되돌리고 고친 파일은 `<이름>-edited`로 치운다 → 고치려면 `layout.clone`·`mod.clone`으로 복제본을 고친다.
- **단축키가 mod를 가리키면 앱이 그 mod 칸을 스스로 넣는다.** 손으로 또 넣으면 두 번 동작한다(그림 두 장). 설치 스크립트는 중복이면 하나만 남긴다.
- mod는 **레이아웃에 칸이 있어야 돈다**(높이 0 칸이면 화면엔 안 보임).
- 복제본 `main.js`를 손으로 고치면 다음 적용 때 `손으로 고친 흔적`으로 멈춘다 → 계속 쓸 수정이면 설치 스크립트를 고친다(`DEV.md`). 앱 업데이트의 화면 개선은 설치를 다시 돌리면 들어온다(원본에서 다시 만듦).
- **끌어 옮기다 세션이 화면에서 사라지면 죽은 게 아니라 떼어진 채 남은 것이다.** `hc ls`엔 보이고, `hc get <t> --json`으로 보면 `keep:false`에 `herdr.space` 이름표가 없다. (0.3.0부터는 못 붙이면 원래 공간에 되돌리고 알림을 띄우지만, 그래도 사라졌을 때) 되살리기: ① `herdr-app do space.select '{"id":"<공간 id>"}'` ② `herdr-app do terminal.keep '{"terminal":"<t>","place":"tab"}'` ③ `tab.rename`으로 탭 이름 되돌리기. 공간 id는 같은 공간에 있는 다른 세션의 `herdr.space` 이름표에서 알 수 있다.
- **앱에서 공간(space)을 지우면 안의 세션도 같이 꺼진다**(2026-11-17 실측 — 지운 뒤 `hc ls`에 없음). 세션을 살리려면 먼저 다른 공간으로 끌어 옮긴 뒤 지운다. 웹 휴지통은 다르다 — 공간만 지우고 세션은 떼어진 채 남긴다(2-2).
- **resume-all(우상단 Resume):** 후보 = 이 PC의 살아 있는 셸 중 에이전트가 안 돌고, 세션 이름표 `claude.session`·`claude.project`가 있고, 화면에 창이 있는 것. 세션 이름표 훅(0.4.0~)이 깔리기 전에 시작한 세션은 이름표가 없어 안 나온다. `/exit`로 claude만 끄고 셸을 남긴 탭도 후보라 팝업에서 체크로 고른다. 이어한 claude가 상태를 보고하면 후보에서 빠져 버튼 숫자가 준다. 원격 기기(macOS 등) 터미널은 안 나온다(그쪽엔 이름표 훅이 없고 기록 읽기가 PowerShell).
- **재부팅 재현 = `hc server stop` → `hc server start`**(herdr **밖** PowerShell에서 — herdr 안 터미널은 같이 죽는다). `hc server restart`는 프로그램을 안 끊어서 재현이 안 된다. 일하던 Claude의 진행 중 턴은 잘린다. 가벼운 시험: 아무 셸 탭에 `hc label <t> claude.session=<기존 세션 id> claude.project=<기록 폴더 이름>` → `Resume 1`로 뜬다(다른 폴더 세션이면 폴더 옮기기까지 시험됨). 끝나면 그 탭을 닫는다.
- **Ctrl+N은 앱이 먼저 받는다**(터미널 안에서도) → Claude 입력 기록 이동은 ↓ 키로. Ctrl+N이 이미 다른 동작에 걸려 있으면 설치가 멈춘다. 예전 ccd-key(mod가 키를 받음)는 자주 안 먹어서 0.9.0에 앱 자체 `tab.new`로 바꿨다 — Claude 탭은 우상단 `+` 메뉴로 연다.
- 탭 x 두 번 눌러 닫기는 **상단 탭 x만**이다. `Ctrl+Shift+W`(tab.close)·우클릭 메뉴 닫기는 그대로 바로 닫힌다.
- 그림 붙여넣기 뒤 클립보드엔 그림 대신 파일(`C:\Users\Public\herdr-paste\paste-*.png`)이 남는다.
- 원래 단축키 설정은 `keys.json.bak-imagepaste`·`keys.json.bak-ccdkey`로 백업된다. 화면이 망가지면 앱에서 `Ctrl+Alt+Shift+Esc`(기본 화면 복귀).
- 왼쪽 Agents에 안 보이는 Claude 탭 = 백그라운드로 돌던 세션을 `/resume`으로 연 경우 → `claude stop <id>` 후 그 탭에서 `claude --resume`.
- `Alt+위/아래`는 Agents 목록 순서, `Ctrl+PageUp/PageDown`은 상단 탭 순서다(버그 아님).
- 설정 폴더 `~/.config/herdr-app/`(`AGENTS.md`가 앱 전체 설명서 — 단축키 규칙은 「Keys」 절).

---

# 2갈래. 서버·웹 관제 연동 — `$K/server/`, `hooks/`

앱 mod(1갈래)는 그 PC 화면에서만 돈다. 여기는 **서버가 엔진 문서·이름표를 직접 고쳐서** 앱이 꺼져 있어도, 앱이 업데이트돼도, 웹 관제 화면에서도 같은 상태가 보이게 하는 것들이다.

## 2-1. 서버 상주 탭 이름 동기화 (herdr-title-sync)

Claude는 `/rename` 이름을 **창 제목**으로 내보내고, 서버 herdr-core는 자기가 보는 모든 기기의 터미널 제목을 한 목록(`terminal.list`)으로 갖는다. 앱 사이드바는 머신마다 엔진 문서 `herdr-app`으로 그리므로, **서버 상주 프로그램이 그 문서의 탭 이름을 직접 고친다.**

- 설치(서버, 플러그인 버전이 바뀌어도 서비스가 안 끊기게 고정 위치로 복사):
  ```bash
  mkdir -p ~/.local/share/herdr-title-sync ~/.config/systemd/user
  cp "$K/server/herdr_title_sync.py" ~/.local/share/herdr-title-sync/
  cp "$K/server/herdr-title-sync.service" ~/.config/systemd/user/
  systemctl --user daemon-reload && systemctl --user enable --now herdr-title-sync
  ```
  플러그인을 갱신한 뒤 스크립트가 바뀌었으면 `cp` 다시 + `systemctl --user restart herdr-title-sync`. 바뀌었는지: `diff -q ~/.local/share/herdr-title-sync/herdr_title_sync.py "$K/server/herdr_title_sync.py"`.
- 확인: `journalctl --user -u herdr-title-sync -n 20`(「탭 이름 바꿈」), 시험만: `python3 herdr_title_sync.py --once --dry-run`, 테스트: `python3 -m pytest "$K/server/tests"`.
- 규칙: 이름 없던 탭은 바로 제목으로 / 직접 이름 붙인 탭은 제목이 **바뀔 때만** / Claude 창이 둘 이상인 탭·「Claude Code」 기본 제목은 안 건드림 / 문서 version을 맞춰 써서 앱과 동시에 바뀌면 다음 차례(3초)에 다시.
- 한계: `/rename` 안 한 세션도 Claude 자동 제목이 붙어 이름 없던 탭에 들어간다(제목만으론 구별 불가). 앱 문서 형식이 바뀌면 손봐야 한다.
- **1갈래 title-sync mod와 어느 쪽을 쓰나**: 서버가 machine add로 보고 있는 PC는 서버 동기화만으로 충분하다. 서버와 안 이어진 PC(혼자 쓰는 PC)는 앱 mod를 깐다. 둘 다 있어도 같은 이름을 쓰므로 해는 없다.

## 2-2. 빈 공간 되돌리기 (같은 프로그램, 0.5.2)

앱에서 마지막 탭을 닫아 사라진 공간을 **문서에 탭 0개 공간(`tabs: []`)으로 되돌린다** — 앱은 그런 공간을 지우지 않고 보통 공간처럼 보여 주므로, 앱·웹·다른 PC가 같은 빈 공간을 본다(1갈래 my-spaces의 흐린 줄은 그 PC에만 보임 — 서버와 이어진 PC에선 진짜 빈 공간이 생기면서 흐린 줄은 스스로 사라진다).
- 되돌리는 것: **탭이 딱 1개였던, 이름 있는 공간**이 사라졌고 그 안의 세션이 죽었거나 다른 공간으로 옮겨졌을 때. 같은 id·같은 자리.
- 안 되돌리는 것: 탭 여러 개인 공간을 통째로 닫음 / 이미 비어 있던 공간을 지움 / 이름 없는 공간(문서 name이 "") / **세션이 살아 있는데 어느 공간에도 없음**(공간만 지우는 도구로 일부러 지운 것). 끌어 옮기는 도중에도 잠깐 이 상태라 `KEEP_WAIT_SECONDS`(10초) 지켜본 뒤 판단한다.
- 서버와 이어진 기기만 본다. 프로그램을 다시 켠 직후 첫 차례는 기억만 한다(그 사이 사라진 공간은 못 되돌림).
- 빈 공간을 없애려면: 앱에서 그 공간 우클릭 Close(또는 문서에서 그 공간을 지우는 도구).
- 확인: `journalctl --user -u herdr-title-sync | grep 되돌림`

## 2-3. '끝남' → '쉬는 중' (봤음 표시)

엔진 상태 `done` = "사용자가 안 보는 사이 끝남". 엔진 상태는 `done`으로 남고, '봤음'은 이름표로 따로 둔다.
- **앱**: 앱이 탭을 보면 엔진 터미널에 이름표 `herdr.seen=<본 턴 번호>`를 붙인다 → `turn`과 같으면 봤음. 엔진 이름표라 서버에서도 `hc get --json`의 `labels`로 보인다(앱 실행 파일에도 이 이름이 있다).
- **다른 화면(웹 관제 등)**: 이 이름표를 읽으면 앱에서 본 끝남을 쉬는 중으로 보일 수 있고, 그 화면에서 봤을 때 `hc label <t> herdr.seen=<turn>`으로 올리면 앱과 맞춰진다. 앱이 남이 올린 이름표를 따르는지는 아직 확인 안 됨.
- 언제 '봤음'으로 치나: **done 세션을 연 순간이 아니라, 열어 본 뒤 다른 세션을 누를 때.** 앱은 1갈래 done-hold로 표시만 늦춘다. 다른 화면도 같은 규칙을 따르는 게 좋다(페이지를 그냥 떠나면 기록 안 함).

## 2-4. 세션 이름표 훅 — `hooks/label_session.py`

플러그인이 `SessionStart`(새로·/clear·resume)마다 herdr 터미널에 `claude.session=<세션 id>`·`claude.project=<기록 폴더 이름>` 이름표를 단다.
웹 관제 화면이 이 둘로 `~/.claude/projects/<project>/<session>.jsonl`을 찾아 대화를 보여 준다. herdr 밖에서는 아무것도 안 한다.
- 훅은 백그라운드(`async`, 0.9.1)로 돈다 — 세션 시작을 막지 않는 대신 이름표가 몇 초 늦게 붙을 수 있다(보안 프로그램 있는 Windows는 셸 하나 띄우는 데 1초쯤). 이름표를 읽는 쪽은 없으면 나중에 다시 읽게 만든다.
- 이름표가 안 보이면: 그 터미널의 claude를 한 번 다시 켠다(훅은 세션 시작 때만 돈다). `hc get --json -- tN`의 `labels`로 확인.
- `python`이나 `python3` 중 하나가 PATH에 있어야 한다.
