---
name: herdr-use
description: herdr(에이전트 터미널 관리자 — 여러 PC의 Claude Code 세션을 한 창에서 보고 서로 일을 시키는 도구)를 쓰고 붙이고 점검할 때의 함정 모음 + 데스크톱 앱 커스텀 기능별 설치(상태 확인 → 미리보기 → 고른 것만 적용). 명령 사용법은 `hc --help`·`herdr-app --help`가 원천이고, 여기엔 도움말에 없는 것만 있다 — 앱(herdr-app)과 본체(herdr-core/hc) 구분, 연결 방향, Windows PC에 SSH로 붙이기, hc send·hc run 함정, 데스크톱 앱 커스텀 7종(내 레이아웃 복제, /rename → 탭 이름, Ctrl+Shift+V 그림 붙여넣기, Agents 목록 세션명만, 탭 「Claude Code」·점선, + 메뉴 ccd, Ctrl+N 새 Claude 탭)과 서버 상주 탭 이름 동기화(herdr-title-sync, systemd). 'herdr 세팅', 'herdr 연결', 'PC 추가로 붙여줘', 'herdr 커스텀 깔아줘', 'herdr 커스텀 상태', '플러그인 올렸으니 커스텀 맞춰줘', 'herdr 탭 이름', 'rename 하면 탭 이름 바뀌게', 'herdr 그림 붙여넣기', 'Ctrl+N 새 탭', 'hc 명령', 'herdr 안 보여/연결 안 돼' 요청 시 사용.
---

# herdr-use — herdr 쓰기·잇기·커스텀

> 서버 Linux(herdr-core만) + Windows PC(데스크톱 앱) 실제 구성에서 겪은 것만 적는다. **명령·옵션은 적지 않는다 — `hc --help`, `hc <명령> --help`, `herdr-app --help`, `herdr-app commands`를 본다.**

## 이 스킬의 파일 찾기

플러그인 설치본은 버전마다 폴더가 바뀐다. 최신 폴더를 이렇게 찾는다(`head -1` 금지 — 버전 정렬이 틀어짐):

```bash
K="$(ls -d ~/.claude/plugins/cache/*/herdr/*/skills/herdr-use 2>/dev/null | tail -1)"
```

- `$K/desktop/` — 데스크톱 앱 커스텀 기능별 설치 묶음(Windows). 설명 `desktop/README.md`
- `$K/server/` — 서버 상주 탭 이름 동기화(`herdr_title_sync.py`, systemd 서비스, 테스트)

## 0. 개념 3줄

- **herdr-core (`hc`)** = 각 PC에서 뒤로 도는 본체. 터미널·Claude 세션은 여기서 산다. 앱을 닫아도 안 죽는다.
- **herdr-app** = 화면(Windows/macOS 데스크톱 앱). 화면 없는 서버엔 core만 있으면 된다.
- 구조: **기기 → 공간(space) → 탭(tab) → 창(pane)**. 공간은 탭 묶음 폴더, `hc label`은 탭에 붙이는 자유 이름표. 탭 번호(1, 2…)는 공간마다 따로 매긴다.

## 1. 설치·연결 함정

- Linux 서버엔 따로 안 깐다 — **앱에서 machine add 하면 앱이 SSH로 `~/.local/bin/herdr-core`(+`hc` 링크)를 깔고 `serve`를 띄운다.** Windows는 앱 설치(`%LOCALAPPDATA%\Programs\herdr-app\`, core는 `...\herdr-core\`).
- **`machine add`는 한쪽 방향이다.** A에서 `hc machine add B` = A가 B를 본다. B는 A를 모른다. 서버 → PC도 보려면 PC에 SSH 서버가 있어야 한다(2절).
- 원격 세션 주소는 `pc/t2`처럼 기기 이름이 앞에 붙는다. 주소가 16진수(t1a 등)인 건 herdr 기본 번호 방식.

## 2. 서버 → Windows PC 방향 열기 (가장 함정 많음)

1. OpenSSH 서버 켜기(관리자 PowerShell): `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Set-Service sshd -StartupType Automatic; Start-Service sshd`
2. 키는 서버 전용으로 새로: `ssh-keygen -t ed25519 -f ~/.ssh/herdr_pc_ed25519 -N ""`
3. **PC 사용자가 관리자 그룹이면 `~/.ssh/authorized_keys`를 무시한다.** 공개키는 `C:\ProgramData\ssh\administrators_authorized_keys`에 넣고 권한을 Administrators·SYSTEM만으로:
   `icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"`
4. `sshd_config`에 `PasswordAuthentication no`, 방화벽 규칙 `OpenSSH SSH Server (sshd)`의 원격 주소는 **서버 IP 하나로** 좁힌다.
5. 서버 `~/.ssh/config`에 별칭 `pc`(HostName `<PC 내부 IP>`, User `<Windows 사용자명>` — 한글 사용자명도 그대로 됨, IdentityFile 위 키, IdentitiesOnly yes, ConnectTimeout 8).
6. `ssh -o BatchMode=yes pc "echo ok"` 통과 후 machine add → connected가 될 때까지 몇 초 기다린다.
- Windows 기본 셸은 cmd라 원격 명령도 cmd 문법. PC가 절전이면 안 붙는다.

## 3. Linux 서버 함정

- **herdr 창에서 `claude: command not found`**: herdr가 여는 셸은 `~/.bashrc`만 읽는다. `~/.local/bin` PATH 줄이 `~/.profile`에만 있으면 못 찾는다 → `.bashrc`에도 넣는다. 열려 있던 창은 `source ~/.bashrc`.

- **Claude 세션 안에서 `hc`를 부를 때 core가 새로 뜨면(업데이트·`hc server restart`·처음 시작) 그 Claude의 환경변수를 core가 그대로 물려받는다** → 그 뒤 여는 모든 탭의 Claude가 `Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker` 경고를 띄우고 대화 기록을 안 남긴다(`/resume` 불가). core는 systemd-run 임시 유닛(`hc-serve-*`·`hc-hold-*`)으로 뜨고 띄운 셸의 환경을 `EnvironmentFile`로 넘긴다(SSH_* 등만 뺌).
  - 확인: `tr "\0" "\n" </proc/$(systemctl --user show "$(systemctl --user list-units --no-legend 'hc-serve-*' | awk '{print $1}')" -p MainPID --value)/environ | grep CLAUDE`
  - 막기(한 번만): 이름 앞부분 drop-in `~/.config/systemd/user/hc-serve-.service.d/no-claude-env.conf`와 `hc-hold-.service.d/no-claude-env.conf`에 `[Service]` + `UnsetEnvironment=AI_AGENT CLAUDECODE CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_DISABLE_BACKGROUND_TASKS CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_EXECPATH CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_MESSAGING_TOKEN CLAUDE_CODE_SESSION_ATTENDED CLAUDE_CODE_SESSION_ID CLAUDE_EFFORT CLAUDE_PID GIT_EDITOR COREPACK_ENABLE_AUTO_PIN` → `systemctl --user daemon-reload`. 임시 유닛에도 적용된다(`systemctl --user show <유닛> -p DropInPaths`로 확인).
  - 이미 물려받았으면: `hc server restart`(프로그램은 안 끊긴다). 새 탭은 hold가 아니라 core의 환경을 받으므로 hold는 그대로 둬도 된다. 경고가 뜬 채 열려 있는 탭은 그 탭의 claude만 `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 claude`로 다시 켠다.

## 4. 다른 PC 세션에 일 시키기 — 함정

- **`hc send`는 `<hc from="...">…</hc>`로 감싸 보낸다 → Claude 슬래시 명령(`/rename` 등)은 실행되지 않는다.** 슬래시 명령은 사람이 그 창에 직접 친다. 기다릴 땐 sleep 말고 `hc wait`.
- 보낼 글이 `-`로 시작하면 `--` 뒤에 둔다(옵션으로 읽힘).
- **Windows Git Bash에서 `/`로 시작하는 글은 경로로 바뀐다**(`/rename` → `C:/Program Files/Git/rename`) → `MSYS_NO_PATHCONV=1 hc send ...`.
- Windows에서 `hc get` 출력을 파이프로 읽으면 한글이 깨진다 → 바이트로 받아 UTF-8로 디코딩.
- **스크립트·웹에서 `hc run`으로 띄운 터미널은 앱 사이드바에 안 나온다.** 앱은 엔진 문서 `herdr-app`(spaces → tabs)와 터미널 이름표 `herdr.space`·`herdr.tab`을 보고 그린다 → `--label herdr.space=<id> --label herdr.tab=<id>`를 붙이고 문서에 탭도 넣는다(원격 id의 `machine/` 앞부분은 뺀다).

## 5. 데스크톱 앱 커스텀 (Windows) — `$K/desktop/`

기능 7개(+레이아웃 복제)를 **기능별로** 보고 고른 것만 깐다(0.8.0~). 원본 mod 문장 찾아 패치·CRLF·자기 이름 바꾸기·칸 중복 정리 같은 기계적인 일은 스크립트가 하고, **언제 무엇을 돌릴지는 아래 행동 가이드대로 에이전트가 정한다.** 전부 다시 까는 일괄 실행은 하지 않는다 — 안 바뀐 mod 파일을 다시 쓰면 그 직후 Ctrl+N이 한동안 안 먹었다(0.5.4·0.7.0·0.7.2 재적용 때, 원인은 "mod 파일을 다시 쓰면 앱이 mod를 다시 띄우는 사이 키가 안 닿음"으로 **추정**, 미검증).

| 이름 | 기능 | 스크립트 |
|---|---|---|
| `title-sync` | 기본 레이아웃을 내 것(`my-<이름>`)으로 복제(나머지가 이 위에 얹힘) + `/rename`·Claude 자동 제목 → 상단 탭 이름 | `install_title_sync.py` |
| `image-paste` | Ctrl+Shift+V 그림 붙여넣기 (image-paste mod + `clipimg.exe`) — **키를 받는 mod** | `install_image_paste.py` |
| `my-agents` | 좌하단 Agents: 세션명만 + 작업 중이면 "지금 하는 일" | `install_agents_name_only.py` |
| `ccd-button` | 우상단 `+` 메뉴에 ccd(`claude --dangerously-skip-permissions`) — programs.json 항목 + 기본 new-menu 복제본 my-new-menu(ccd를 정한 폴더에서 엶) | `install_ccd_button.py` |
| `my-tabs` | 상단 탭: 이름 없는 Claude 탭은 `Claude Code` + 끌 때 점선 + `+` 버튼이 my-new-menu를 엶 | `install_tabs_agent_name.py` |
| `ccd-key` | Ctrl+N → ccd 새 Claude 탭 (ccd-button과 같은 폴더) — **키를 받는 mod** | `install_ccd_key.py` |
| `my-spaces` | 좌상단 Spaces: ▾/▸로 공간별 세션 목록 펼치기 + 상태·하는 일, 누르면 그 창으로, 다른 공간으로 끌어 옮기기(같은 기기만), 같은 공간 안 순서 바꾸기(`tab.move`, 0.7.2), 세션 0개 공간을 빈 줄로 남기기 | `install_spaces_tree.py` |

**명령** (`$K/desktop/`, 자세한 건 `setup.py --help`)
- `setup.py` = `--status` = `--check`: 전 기능 상태표. **아무것도 안 바꾼다**(앱이 꺼져 있어도 파일만 보고 나옴). `--json` 가능.
- `setup.py --dry-run [이름,…]`: 적용하면 쓸 파일(줄 수)·할 일. 아무것도 안 쓴다.
- `setup.py --apply`: 낡음·없음인 기능만. `--apply title-sync,my-spaces`: 고른 것만. **최신인 기능은 건드리지 않는다**(파일 시각도 그대로). 끝에 바뀐 기능 / 그대로인 기능 / 멈춘 기능 / 바뀐 파일 / 사람이 눌러 볼 것을 따로 보여 준다.
- 기능 하나: `scripts/install_<…>.py --status [--json]` / `--dry-run` / (옵션 없음 = 낡음·없음이면 적용) / `--force` / `--remove`.
- 상태: `최신` · `낡음(무엇이 다른지)` · `없음` · `손으로 고친 흔적` · `고칠 문장 못 찾음(앱 업데이트)` · `오류`. 기능 스크립트 `--status` 종료 코드 0 / 10 / 11 / 12 / 13 / 14.
- **손으로 고친 흔적**은 설치 기록으로 가린다: 스크립트가 mod 파일을 쓸 때마다 해시를 `~/.config/herdr-app/.herdr-custom/installed.json`에 적는다. 설치본이 플러그인판과도, 마지막으로 스크립트가 쓴 내용과도 다르면 손으로 고친 것. 기록이 없는 파일(0.7.x 이전 설치분)은 알 수 없어 `낡음(설치 기록 없음)`으로 나온다 — 첫 적용 뒤부터 가려진다. 섞인 파일(keys.json·programs.json·레이아웃)은 해당 항목만 본다.
- `--remove`(전부·개별)·ccd 폴더 규칙(`scripts/ccd_folder.py`)·원본에서 다시 만드는 patchlib 방식·칸 중복 정리는 그대로다. ccd 새 탭 폴더: `--apply ccd-button,ccd-key --ccd-folder "<경로>"`(`""` = 해제). `--ccd-folder`만 주면 그 폴더 기준 상태만 본다.
- `1_설치.bat` = `--apply`, `2_상태확인.bat` = `--status`.

### 에이전트 행동 가이드 — 커스텀을 깔거나 플러그인 업데이트 뒤 다시 맞출 때

1. **먼저 본다.** `python "$K/desktop/setup.py" --status`. 플러그인을 올린 뒤라면 이전 판과 바뀐 스크립트도 본다: `diff -rq <이전 판>/skills/herdr-use/desktop "$K/desktop"`(이전 판 = `ls -d ~/.claude/plugins/cache/*/herdr/*/ | sort -V`에서 끝에서 두 번째). 앱 응답은 상태표 아래 `앱:` 줄(또는 `herdr-app status`) — `10061`이면 트레이까지 완전히 끄고 다시 켜라고 안내한다(복제본을 새로 만들거나 기본 레이아웃을 복제·전환할 땐 앱이 응답해야 함).
2. **사용자에게 보고하고 고르게 한다.** 기능마다 최신/낡음/없음과, 낡음이면 무엇이 달라지는지 한 줄(`--dry-run <이름>` 결과나 diff에서). **사용자가 고른 것만 적용한다.** "전부 맞춰"라고 하면 낡음·없음만(`--apply`).
3. **손으로 고친 흔적이면 멈춘다.** 사용자가 시험 적용 중인 것일 수 있다. 어떤 파일인지와 백업 위치(`~/.config/herdr-app/.herdr-custom/backup/<시각>/`)를 알리고 **확인을 받은 뒤에만** `--apply <이름> --force`. `고칠 문장 못 찾음`이면 적용하지 말고 그 스크립트의 패치를 새 원본에 맞추는 일로 넘긴다(아래 함정).
4. **적용.** 고른 기능만: `setup.py --apply <이름,…>`(또는 그 기능 스크립트).
5. **검증.** 다시 `--status`로 고른 기능이 `최신`이 됐는지, 결과의 `바뀐 파일:`에 안 고른 기능의 파일이 없는지 본다(예외: ccd-button은 `+` 버튼 연결을 맞추려고 my-tabs를 다시 만들 수 있음 — 결과에 따로 적힘). 앱 오류(`앱:` 줄의 오류, `herdr-app status`의 errors)도 본다.
6. **사람 확인으로 넘긴다.** 키·화면 동작은 에이전트가 시험할 수 없다. 결과의 「사람이 눌러 볼 것」(바뀐 기능만)을 그대로 전한다. **ccd-key(Ctrl+N)·image-paste(Ctrl+Shift+V)처럼 키를 받는 mod를 다시 썼다면 "처음 한 번 안 먹으면 앱 창을 클릭하고 영문 상태에서 다시 누르기"를 같이 안내한다**(결과에 ※로 나옴).

- 에이전트가 직접 해도 되는 진단: `herdr-app do <명령>`으로 mod 명령을 보내 결과를 본다. 예: `herdr-app do ccd-key.new` → 새 탭을 `hc get <t> --json`으로 보고 cwd·argv 확인 → 시험 탭은 `herdr-app do tab.close '{"id":"<탭 id>","confirmed":true}'`로 닫기. **키가 앱에 닿는지(사람)와 mod가 맞게 도는지(에이전트)를 이렇게 나눠 본다.**
- 이미 기본 레이아웃이 아닌 내 레이아웃(예: 직접 복제한 것)을 쓰는 중이면 **새로 복제하지 않고 그 레이아웃에 얹는다.**
- 손으로 눌러 볼 전체 목록은 `desktop/README.md` 「확인 방법」.

**함정**
- **`herdr-app do`/`status`가 `no Herdr window ... (os error 10061)`이면** 앱이 명령을 못 받는 상태다. 오래 떠 있던 앱 프로세스가 이러기도 한다 → 트레이까지 완전히 끄고 다시 켠다. SSH 세션에서도 같은 오류가 난다(앱 창에 못 붙음) → 원격에선 파일만 `hc file write --on pc`로 쓰고 레이아웃 전환은 사람이 한다. ccd-key(파일만 고침)는 앱 응답 없이도 깔리지만 my-agents·my-tabs·ccd-button·my-spaces(mod 복제 — 복제본이 아직 없을 때)와 기본 레이아웃 복제·전환은 앱이 응답해야 한다. 상태 확인(`--status`·`--dry-run`)은 앱 없이 된다.
- **기본 레이아웃·기본 mod는 읽기 전용이다.** 앱이 시작할 때 원본으로 되돌리고 고친 파일은 `<이름>-edited`로 치운다 → 고치려면 `layout.clone`·`mod.clone`으로 복제본을 고친다.
- **단축키가 mod를 가리키면 앱이 그 mod 칸을 스스로 넣는다.** 손으로 또 넣으면 두 번 동작한다(그림 두 장). 설치 스크립트는 중복이면 하나만 남긴다.
- mod는 **레이아웃에 칸이 있어야 돈다**(높이 0 칸이면 화면엔 안 보임).
- my-agents·my-tabs·my-spaces(와 ccd-button의 my-new-menu)는 기본 mod 코드의 문장을 찾아 고친다. **적용할 때마다 원본 `mods/<기본>/main.js`에서 처음부터 다시 고친 내용을 만들고, 복제본과 다를 때만 덮어쓴다**(`scripts/patchlib.py`, 0.3.0~). 복제본을 손으로 고쳤으면 상태가 `손으로 고친 흔적`이 되고 `--force` 없이는 덮지 않는다(덮을 땐 백업) → 계속 쓸 수정이면 설치 스크립트를 고친다. 덮어쓸 때 `mod.clone`처럼 자기 이름 참조(`mods/tabs/…` 아이콘, `openOverlay({ mod: "agents" })`)를 복제본 이름으로 바꾸고, 줄바꿈은 원본(CRLF)을 따른다 — 안 하면 아이콘·팝업이 원본 mod를 가리킨다. 앱 업데이트로 문장이 바뀌면 "고칠 문장을 못 찾음"으로 멈춘다(엉뚱하게 고친 채 남지 않음) → 그 스크립트의 패치를 새 원본에 맞춘다. 원본에서 다시 만들기 때문에 앱 업데이트의 화면 개선도 설치를 다시 돌리면 들어온다.
- my-spaces 앵커 함정: 원본 spaces `main.js`에 `this.refreshMachines(cx);`가 **2번** 나와 앵커로 못 쓴다 → 15000 타이머 줄(`cx.timer.every(15000, …)`)을 앵커로 쓴다. 앱 판마다 원본 문장이 달라(0.1.11은 공간을 번호 `i`, 0.1.13은 `w.id`로 다룸) 몇 패치는 대안 문장을 둔다.
- **앱엔 탭을 다른 공간으로 옮기는 명령이 없다**(`tab.move`는 같은 공간 안 순서만). my-spaces는 `space.select`(대상) → `terminal.park`(창만 떼고 계속 실행, 빈 원래 탭은 앱이 지움) → `terminal.keep {place:"tab"}`(선택된 공간에 새 탭) → keep 탭 이름이 터미널 주소(t18 등)가 되므로 원래 이름이면 `tab.rename`으로 복원. mod의 `run()`은 null을 돌려줘 새 탭 id를 못 받는다 → `cx.sleep`으로 기다리며 `panes()`에서 그 터미널의 pane·tab을 찾는다. **park가 끝나기 전에 keep이 들어가면 keep이 안 먹어 창 없는 세션이 된다**(계속 돌지만 화면에서 사라짐) → 원래 창이 떨어질 때까지(최대 8초) 기다린 뒤 keep, 끝내 안 떨어지면 옮기기를 취소하고 알림(원래 창에 그대로라 잃은 것 없음). keep은 3초씩 최대 3번, **늦게라도 붙었으면 다시 보내지 않는다**(같은 세션 탭이 둘 생기지 않게). 끝내 못 붙이면 원래 공간에 되돌려 붙이고 알림. 이름 없던 탭은 `tab.rename` 빈 이름으로 되돌린다(안 하면 `t18`이 남는다). 대기 시간·횟수는 mod 위쪽 `MOVE_*` 상수(0.3.0).
- **앱엔 빈 공간이 없다**(공간엔 탭이 1개 이상, 마지막 탭을 닫으면 공간도 닫힘) → my-spaces가 사라진 공간을 기억해 흐린 빈 줄로 그린다(0.5.0). 기억하는 곳은 my-spaces 의 localStorage `spaces.kept`(이 화면에만 — 다른 PC·웹엔 안 보임), 내용은 기기·이름·폴더(첫 터미널이 있던 곳)·색. 남기는 건 **탭이 딱 1개였다가 사라진 공간만**이고, 탭 여러 개인 공간을 통째로 닫은 것·이미 비어 있던(탭 0개) 공간을 지운 것은 안 남긴다(0.5.1 — 웹 휴지통으로 지운 빈 공간이 앱에 흐린 줄로 되살아나던 것). **이름을 안 붙인 공간(`spaces()[i].named` 가 false — 화면엔 폴더 이름이나 `~` 로 보임)도 안 남긴다**(0.5.4, 잠깐 연 셸로 봄. 예전 판이 저장해 둔 이름 없는 줄은 다시 켤 때 버린다). **안의 세션이 살아 있는데 어느 공간에도 없으면**(웹 휴지통은 세션을 끄지 않고 공간만 지움) 그것도 안 남긴다(0.5.3 — 사라진 뒤 `hc ls` 로 살아 있는지 보고, 끌어 옮기는 중일 수 있어 `KEPT_LOOSE_WAIT_MS` 10초까지 다시 본다. `hc ls` 를 못 읽으면 남기는 쪽). 6절 서버 상주 프로그램과 같은 규칙. 참고: 앱 문서에 `tabs: []` 공간을 직접 넣으면 앱이 지우지 않고 보통 공간처럼 보여 준다 — somegee.com 서버 터미널은 이 방식으로 빈 공간을 남긴다. 기기 연결이 끊겨 공간이 안 보이는 것과 구별하려고 사라진 뒤 1.5초 동안 그 기기 화면이 `ready` 인지 다시 본다. 빈 줄을 누르면 `space.new {name, folder, machine}` 으로 되살리고(새 id 라 색은 `space.colors` 에 옮겨 적음, 폴더가 없어져 실패하면 폴더 없이 한 번 더), 세션을 끌어 놓으면 되살린 뒤 옮기고 같이 생긴 셸 탭을 닫는다 — **탭이 2개로 보일 때만 닫는다**(1개일 때 닫으면 공간이 또 닫힘). 같은 기기에 같은 이름 공간이 생기면 빈 줄은 스스로 사라진다. 되살린 공간은 그 기기 목록 맨 끝에 붙는다(원래 자리 아님). 대기 시간은 mod 위쪽 `KEPT_*` 상수.
- **끌기 상태가 남으면 나중 클릭에 세션이 옮겨진다**: 세션 줄을 누른 채 목록 밖이나 ▾/▸ 위에서 놓으면 끌기 상태가 지워지지 않아, 다음에 공간 줄을 그냥 눌러도 옮겨졌다(0.2.x 버그). mod의 `on_mouse_move`는 버튼 눌림을 알려 주지 않는다 → 목록 밖으로 나감(`on_hover` false)·밖을 누름(`on_mouse_down_out`)·공간 줄 새로 누름·▾/▸에서 놓음에서 모두 끌기를 지운다.
- **'끝남'은 다른 세션을 누를 때 '쉬는 중'으로 (0.7.0)**: 앱 본체는 done 세션을 **보는 순간** idle로 바꾼다(seen.json — mod로 못 바꿈). 그래서 my-agents·my-tabs·my-spaces 복제본은 **표시만** 늦춘다 — `scripts/done_hold.py`가 mod 안의 `agents()`·`spaces()` 부름을 `shownAgents()`·`shownSpaces()`로 바꿔, 보고 있는 세션이 보기 직전에 done이었으면 그 세션·탭·공간의 idle을 done으로 보여 준다. 다른 세션(또는 셸 창)을 누르거나 다시 일하기 시작하면 놓는다. 보는 중에 끝난 세션은 앱이 처음부터 idle로 두므로 그대로 idle. 앱·엔진 상태·소리는 그대로이고, mod마다 따로 계산한다(같은 규칙이라 답이 같음). 동작 시험: `python -m pytest "$K/desktop/tests"`(node 있으면 JS까지).
- 지금 하는 일(status.msg): my-agents가 3초마다 `hc get`으로 읽어 `shared("agent.msgs")`로 내놓고, my-spaces는 레이아웃에 my-agents가 있으면 그걸 읽는다(없을 때만 직접 읽음) — 같은 조회를 두 번 돌리지 않게.
- **끌어 옮기다 세션이 화면에서 사라지면 죽은 게 아니라 떼어진 채 남은 것이다.** `hc ls`엔 보이고, `hc get <t> --json`으로 보면 `keep:false`에 `herdr.space` 이름표가 없다. (0.3.0부터는 못 붙이면 원래 공간에 되돌리고 알림을 띄우지만, 그래도 사라졌을 때) 되살리기: ① `herdr-app do space.select '{"id":"<공간 id>"}'` ② `herdr-app do terminal.keep '{"terminal":"<t>","place":"tab"}'` ③ `tab.rename`으로 탭 이름 되돌리기. 공간 id는 같은 공간에 있는 다른 세션의 `herdr.space` 이름표에서 알 수 있다.
- **Ctrl+N은 앱이 먼저 받는다**(터미널 안에서도) → Claude 입력 기록 이동은 ↓ 키로. Ctrl+N이 이미 다른 동작에 걸려 있으면 설치가 멈춘다. 한 번 안 먹다가 앱 창을 선택하고 다시 누르니 된 사례가 있다(원인 미확인, 한/영 상태일 수 있음).
- **ccd 탭 폴더**: Ctrl+N·`+` 메뉴 ccd 모두 **설치 때 `--ccd-folder`로 정한 폴더**(안 정했으면 공간 폴더, **다른 기기(원격) 공간은 늘 그 공간 폴더** — `spaces()[i].machine`이 null일 때만 적용, 이 PC 경로는 원격에 없음)에서 연다. 탭은 늘 `claude`를 직접 실행한다 — **PowerShell `ccd` 함수가 없어도 된다**(대부분의 PC엔 없음. 함수를 부르지 않는 이유: herdr는 bash/zsh 함수만 설치 확인을 해서 PowerShell 함수는 "not installed"로 보임).
  - 앱 API `tab.new`는 `folder`를 받지만 programs.json의 `run`엔 폴더 칸이 없다 → `+` 메뉴는 기본 new-menu를 my-new-menu로 복제해 고치고(patchlib), `+` 버튼은 tabs mod 안에 있어서 my-tabs가 `openOverlay({ mod: "my-new-menu" … })`로 연다. **my-new-menu가 있을 때만 그렇게 고친다**(없는데 가리키면 `+`가 아무것도 안 엶) → setup 순서는 ccd 버튼 → my-tabs, ccd-button 설치·`--remove` 뒤엔 my-tabs를 다시 맞춘다(`refresh()`). my-new-menu는 팝업이라 레이아웃 칸이 없다. `KNOWN`("new-menu.agents") 캐시 키는 원본과 같이 쓴다.
  - 폴더 정하는 순서(`scripts/ccd_folder.py`): ① 옵션 ② **설치본 값 유지**(ccd-key `const FOLDER`, my-new-menu `const CCD_FOLDER` 줄 — 안 그러면 setup을 다시 돌릴 때마다 폴더가 사라짐, `""`로 해제해 둔 것도 유지) ③ 설치본에 그 줄이 없을 때만 PowerShell 프로필의 `function ccd { Set-Location "<경로>" … }`(프로필 위치는 `$PROFILE`을 powershell·pwsh에 물어봄 — OneDrive 문서 폴더 대비. `cd`·`-Path`·변수·`Push-Location` 등 다른 형식이면 조용히 건너뜀) ④ `""`.
  - 설치 때 폴더가 없으면 경고하고 `""`(없는 폴더로 `tab.new`하면 탭이 안 열림), `claude`가 PATH에 없으면 경고(`+` 메뉴는 "not installed"로 흐림, Ctrl+N은 오류 알림). 상태표 아래 `ccd 폴더: …` 줄, 두 설치본 값이 다르면 경고.
  - 설치 뒤 폴더가 지워진 경우: mod가 누를 때 `exec("cmd", ["/c","exit"], {cwd})`로 확인(`exec`는 cwd가 없으면 거절)하고, 없으면 공간 폴더로 열고 `notify`로 알린다. `run()`은 null이라 tab.new 실패를 직접 알 수 없어서다. `+` 메뉴는 메뉴를 열 때 미리 확인하고 결과가 오기 전에 누르면 폴더를 믿고 넘긴다. **이 확인은 시험 적용 전이다**(폴더 지정 자체는 2026-11-11 herdr-app에서 확인됨).
- 그림 붙여넣기: 앱은 Windows 로컬 창에 클립보드 **글자만** 붙인다. mod가 `clipimg.exe`(설치 때 .NET Framework 4 `csc.exe`로 빌드, 인터넷 안 씀)로 그림을 `C:\Users\Public\herdr-paste\paste-*.png`에 저장하고 클립보드를 '복사한 파일'로 바꾼 뒤 `terminal.paste` → 경로가 들어가고 Claude가 그림으로 읽는다. 원격 창이면 바로 `terminal.paste`(앱이 그림을 그 기기로 복사). 붙인 뒤 클립보드엔 그림 대신 파일이 남는다. Claude 자체 Alt+V는 PowerShell을 띄워 느려서 안 쓴다.
- 원래 단축키 설정은 `keys.json.bak-imagepaste`·`keys.json.bak-ccdkey`로 백업된다. 화면이 망가지면 앱에서 `Ctrl+Alt+Shift+Esc`(기본 화면 복귀).
- 왼쪽 Agents에 안 보이는 Claude 탭 = 백그라운드로 돌던 세션을 `/resume`으로 연 경우 → `claude stop <id>` 후 그 탭에서 `claude --resume`.
- `Alt+위/아래`는 Agents 목록 순서, `Ctrl+PageUp/PageDown`은 상단 탭 순서다(버그 아님).
- 설정 폴더 `~/.config/herdr-app/`(`AGENTS.md`가 앱 전체 설명서 — 단축키 규칙은 「Keys」 절).

## 6. 서버 상주 탭 이름 동기화 + 빈 공간 남기기 — `$K/server/`

Claude는 `/rename` 이름을 **창 제목**으로 내보내고, 서버 herdr-core는 자기가 보는 모든 기기의 터미널 제목을 한 목록(`terminal.list`)으로 갖는다. 앱 사이드바는 머신마다 엔진 문서 `herdr-app`으로 그리므로, **서버 상주 프로그램이 그 문서의 탭 이름을 직접 고친다** → 앱이 꺼져 있어도, 앱이 업데이트돼도 따라가고, 웹 관제 화면도 같은 이름을 본다.

- 설치(서버, 플러그인 버전이 바뀌어도 서비스가 안 끊기게 고정 위치로 복사):
  ```bash
  mkdir -p ~/.local/share/herdr-title-sync ~/.config/systemd/user
  cp "$K/server/herdr_title_sync.py" ~/.local/share/herdr-title-sync/
  cp "$K/server/herdr-title-sync.service" ~/.config/systemd/user/
  systemctl --user daemon-reload && systemctl --user enable --now herdr-title-sync
  ```
  플러그인을 갱신한 뒤 스크립트가 바뀌었으면 `cp` 다시 + `systemctl --user restart herdr-title-sync`.
- 확인: `journalctl --user -u herdr-title-sync -n 20`(「탭 이름 바꿈」), 시험만: `python3 herdr_title_sync.py --once --dry-run`, 테스트: `python3 -m pytest "$K/server/tests"`.
- 규칙: 이름 없던 탭은 바로 제목으로 / 직접 이름 붙인 탭은 제목이 **바뀔 때만** / Claude 창이 둘 이상인 탭·「Claude Code」 기본 제목은 안 건드림 / 문서 version을 맞춰 써서 앱과 동시에 바뀌면 다음 차례(3초)에 다시.
- 한계: `/rename` 안 한 세션도 Claude 자동 제목이 붙어 이름 없던 탭에 들어간다(제목만으론 구별 불가). 앱 문서 형식이 바뀌면 손봐야 한다.

**5절 title-sync mod와 어느 쪽을 쓰나**: 서버가 machine add로 보고 있는 PC는 서버 동기화만으로 충분하다. 서버와 안 이어진 PC(혼자 쓰는 PC)는 앱 mod를 깐다. 둘 다 있어도 같은 이름을 쓰므로 해는 없다.

### 빈 공간 남기기 (같은 프로그램, 0.5.2)
앱에서 마지막 탭을 닫아 사라진 공간을 **문서에 탭 0개 공간(`tabs: []`)으로 되돌린다** — 앱은 그런 공간을 지우지 않고 보통 공간처럼 보여 주므로, 앱·웹·다른 PC 가 같은 빈 공간을 본다(5절 my-spaces 의 흐린 줄은 그 PC 에만 보임 — 서버와 이어진 PC 에선 진짜 빈 공간이 생기면서 흐린 줄은 스스로 사라진다).
- 되돌리는 것: **탭이 딱 1개였던, 이름 있는 공간**이 사라졌고 그 안의 세션이 죽었거나 다른 공간으로 옮겨졌을 때. 같은 id·같은 자리.
- 안 되돌리는 것: 탭 여러 개인 공간을 통째로 닫음 / 이미 비어 있던 공간을 지움 / 이름 없는 공간(문서 name 이 "") / **세션이 살아 있는데 어느 공간에도 없음**(웹 휴지통은 세션을 끄지 않고 공간만 지운다 — 일부러 지운 것). 끌어 옮기는 도중에도 잠깐 이 상태라 `KEEP_WAIT_SECONDS`(10초) 지켜본 뒤 판단한다.
- 서버와 이어진 기기만 본다. 프로그램을 다시 켠 직후 첫 차례는 기억만 한다(그 사이 사라진 공간은 못 되돌림).
- 빈 공간을 없애려면: 웹 휴지통, 또는 앱에서 그 공간 우클릭 Close.
- 확인: `journalctl --user -u herdr-title-sync | grep 되돌림`

### '끝남' → '쉬는 중'
엔진 상태 `done` = "사용자가 안 보는 사이 끝남". 앱은 화면마다 '봤음'을 따로 기록해(`~/.config/herdr-app/seen.json`) idle로 바꾸고 엔진 상태는 `done`으로 남는다. 다른 화면(웹 등)이 같이 '봤음'을 공유하려면 엔진 문서에 따로 기록해야 한다.
- 언제 '봤음'으로 치나(2026-11-11 지윤님 요청): **done 세션을 연 순간이 아니라, 열어 본 뒤 다른 세션을 누를 때.** 앱은 5절 done-hold로 표시만 늦추고, 웹(somegee.com 서버 터미널)은 `useHerdrSeen`이 다른 터미널로 옮길 때 `/seen`을 보낸다(페이지를 그냥 떠나면 기록 안 함).

## 7. 세션 이름표 훅 — `hooks/label_session.py`

플러그인이 `SessionStart`(새로·/clear·resume)마다 herdr 터미널에 `claude.session=<세션 id>`·`claude.project=<기록 폴더 이름>` 이름표를 단다.
웹 관제 화면이 이 둘로 `~/.claude/projects/<project>/<session>.jsonl`을 찾아 대화를 보여 준다. herdr 밖에서는 아무것도 안 한다.
- 이름표가 안 보이면: 그 터미널의 claude를 한 번 다시 켠다(훅은 세션 시작 때만 돈다). `hc get --json -- tN`의 `labels`로 확인.
- `python`이나 `python3` 중 하나가 PATH에 있어야 한다.

## 점검 순서 (안 될 때)

1. `hc machine ls` — connected인가 (방향 확인: 어느 쪽에서 add 했나)
2. `ssh -o BatchMode=yes <호스트> "echo ok"` — SSH 자체
3. `hc ls` — 세션이 보이나 / 앱엔 안 보이면 4절 이름표
4. `herdr-app status` — mod·레이아웃 오류, 10061이면 앱 재시작(5절)
5. `python "$K/desktop/setup.py" --status` — 기능별 상태(최신·낡음·없음·손으로 고친 흔적)
