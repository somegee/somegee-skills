---
name: herdr-use
description: herdr(에이전트 터미널 관리자 — 여러 PC의 Claude Code 세션을 한 창에서 보고 서로 일을 시키는 도구)를 쓰고 붙이고 점검할 때의 함정 모음 + 데스크톱 앱 커스텀 일괄 설치. 명령 사용법은 `hc --help`·`herdr-app --help`가 원천이고, 여기엔 도움말에 없는 것만 있다 — 앱(herdr-app)과 본체(herdr-core/hc) 구분, 연결 방향, Windows PC에 SSH로 붙이기, hc send·hc run 함정, 데스크톱 앱 커스텀 7종(내 레이아웃 복제, /rename → 탭 이름, Ctrl+Shift+V 그림 붙여넣기, Agents 목록 세션명만, 탭 「Claude Code」·점선, + 메뉴 ccd, Ctrl+N 새 Claude 탭)과 서버 상주 탭 이름 동기화(herdr-title-sync, systemd). 'herdr 세팅', 'herdr 연결', 'PC 추가로 붙여줘', 'herdr 커스텀 깔아줘', 'herdr 탭 이름', 'rename 하면 탭 이름 바뀌게', 'herdr 그림 붙여넣기', 'Ctrl+N 새 탭', 'hc 명령', 'herdr 안 보여/연결 안 돼' 요청 시 사용.
---

# herdr-use — herdr 쓰기·잇기·커스텀

> 서버 Linux(herdr-core만) + Windows PC(데스크톱 앱) 실제 구성에서 겪은 것만 적는다. **명령·옵션은 적지 않는다 — `hc --help`, `hc <명령> --help`, `herdr-app --help`, `herdr-app commands`를 본다.**

## 이 스킬의 파일 찾기

플러그인 설치본은 버전마다 폴더가 바뀐다. 최신 폴더를 이렇게 찾는다(`head -1` 금지 — 버전 정렬이 틀어짐):

```bash
K="$(ls -d ~/.claude/plugins/cache/*/herdr/*/skills/herdr-use 2>/dev/null | tail -1)"
```

- `$K/desktop/` — 데스크톱 앱 커스텀 일괄 설치 묶음(Windows). 설명 `desktop/README.md`
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

## 4. 다른 PC 세션에 일 시키기 — 함정

- **`hc send`는 `<hc from="...">…</hc>`로 감싸 보낸다 → Claude 슬래시 명령(`/rename` 등)은 실행되지 않는다.** 슬래시 명령은 사람이 그 창에 직접 친다. 기다릴 땐 sleep 말고 `hc wait`.
- 보낼 글이 `-`로 시작하면 `--` 뒤에 둔다(옵션으로 읽힘).
- **Windows Git Bash에서 `/`로 시작하는 글은 경로로 바뀐다**(`/rename` → `C:/Program Files/Git/rename`) → `MSYS_NO_PATHCONV=1 hc send ...`.
- Windows에서 `hc get` 출력을 파이프로 읽으면 한글이 깨진다 → 바이트로 받아 UTF-8로 디코딩.
- **스크립트·웹에서 `hc run`으로 띄운 터미널은 앱 사이드바에 안 나온다.** 앱은 엔진 문서 `herdr-app`(spaces → tabs)와 터미널 이름표 `herdr.space`·`herdr.tab`을 보고 그린다 → `--label herdr.space=<id> --label herdr.tab=<id>`를 붙이고 문서에 탭도 넣는다(원격 id의 `machine/` 앞부분은 뺀다).

## 5. 데스크톱 앱 커스텀 (Windows) — `$K/desktop/`

8가지를 한 번에 깐다. **앱이 켜져 있어야 한다**(레이아웃·mod 복제를 앱에 시킴). 여러 번 돌려도 결과가 같다(이미 된 건 건너뜀).

| # | 기능 | 스크립트 |
|---|---|---|
| 1 | 기본 레이아웃을 내 것(`my-<이름>`)으로 복제 — 2~8이 이 위에 얹힘 | `install_title_sync.py` 안에서 |
| 2 | `/rename`·Claude 자동 제목 → 상단 탭 이름 (title-sync mod) | `install_title_sync.py` |
| 3 | Ctrl+Shift+V 그림 붙여넣기 (image-paste mod + `clipimg.exe`) | `install_image_paste.py` |
| 4 | 좌하단 Agents: 세션명만 + 작업 중이면 "지금 하는 일" (my-agents) | `install_agents_name_only.py` |
| 5 | 상단 탭: 이름 없는 Claude 탭은 `Claude Code` + 끌 때 점선 (my-tabs) | `install_tabs_agent_name.py` |
| 6 | 우상단 `+` 메뉴에 ccd(`claude --dangerously-skip-permissions`) | `install_ccd_button.py` |
| 7 | Ctrl+N → ccd 새 Claude 탭 (ccd-key mod) | `install_ccd_key.py` |
| 8 | 좌상단 Spaces: ▾/▸로 공간별 세션 목록 펼치기 + 세션 상태·작업 중이면 하는 일, 누르면 그 창으로, 세션을 끌어 다른 공간으로 옮기기(같은 기기만) (my-spaces) | `install_spaces_tree.py` |

- 전부: `python "$K/desktop/setup.py"` / 상태만: `--check` / 전부 되돌리기: `--remove`. 하나만: `python "$K/desktop/scripts/<스크립트>"`(`--remove`로 개별 해제).
- 이미 기본 레이아웃이 아닌 내 레이아웃(예: 직접 복제한 것)을 쓰는 중이면 **새로 복제하지 않고 그 레이아웃에 얹는다.** `--check`의 "my-main 이어야" 문구는 그 경우 무시.
- 끝나면 `--check`에서 각 mod `칸 1개 OK`, `앱 오류: 없음`을 본다. 키·화면 동작은 SSH나 `hc send`로는 시험할 수 없다 — 사람이 그 PC에서 직접 눌러 본다(`desktop/README.md` 「확인 방법」).

**함정**
- **`herdr-app do`/`status`가 `no Herdr window ... (os error 10061)`이면** 앱이 명령을 못 받는 상태다. 오래 떠 있던 앱 프로세스가 이러기도 한다 → 트레이까지 완전히 끄고 다시 켠다. SSH 세션에서도 같은 오류가 난다(앱 창에 못 붙음) → 원격에선 파일만 `hc file write --on pc`로 쓰고 레이아웃 전환은 사람이 한다. 6·7(파일만 고침)은 앱 응답 없이도 깔리지만 4·5·8(mod 복제)은 앱이 응답해야 한다.
- **기본 레이아웃·기본 mod는 읽기 전용이다.** 앱이 시작할 때 원본으로 되돌리고 고친 파일은 `<이름>-edited`로 치운다 → 고치려면 `layout.clone`·`mod.clone`으로 복제본을 고친다.
- **단축키가 mod를 가리키면 앱이 그 mod 칸을 스스로 넣는다.** 손으로 또 넣으면 두 번 동작한다(그림 두 장). 설치 스크립트는 중복이면 하나만 남긴다.
- mod는 **레이아웃에 칸이 있어야 돈다**(높이 0 칸이면 화면엔 안 보임).
- 4·5·8은 기본 mod 코드의 문장을 찾아 고친다. 앱 업데이트로 문장이 바뀌면 "고칠 문장을 못 찾음"으로 멈춘다(엉뚱하게 고친 채 남지 않음) → 그 스크립트의 `PATCHES`를 새 `mods/agents|tabs|spaces/main.js`에 맞춘다. 복제본은 앱 업데이트의 화면 개선을 안 받는다 — 받으려면 README 「herdr 업데이트 후」.
- 8번 앵커 함정: 원본 spaces `main.js`에 `this.refreshMachines(cx);`가 **2번** 나와 앵커로 못 쓴다 → 15000 타이머 줄(`cx.timer.every(15000, …)`)을 앵커로 쓴다. 고치기는 세 단계(트리 `// ---- my-spaces ----` → 끌어 옮기기 `// ---- my-spaces drag ----` → 재시도 `// ---- my-spaces drag retry ----`)라 표식 없는 단계만 더한다(앞 단계만 깔린 PC엔 뒤 단계만). 앱 판마다 원본 문장이 달라(0.1.11은 공간을 번호 `i`, 0.1.13은 `w.id`로 다룸) 몇 패치는 대안 문장을 둔다.
- **앱엔 탭을 다른 공간으로 옮기는 명령이 없다**(`tab.move`는 같은 공간 안 순서만). 8번은 `space.select`(대상) → `terminal.park`(창만 떼고 계속 실행, 빈 원래 탭은 앱이 지움) → `terminal.keep {place:"tab"}`(선택된 공간에 새 탭) → keep 탭 이름이 터미널 주소(t18 등)가 되므로 원래 이름이면 `tab.rename`으로 복원. mod의 `run()`은 null을 돌려줘 새 탭 id를 못 받는다 → `cx.sleep`으로 기다리며 `panes()`에서 그 터미널의 pane·tab을 찾는다. **park가 끝나기 전에 keep이 들어가면 keep이 안 먹어 창 없는 세션이 된다**(계속 돌지만 화면에서 사라짐) → 원래 창이 없어질 때까지 기다린 뒤 keep, 새 창이 안 생기면 대상 공간을 다시 고르고 최대 4번 다시 붙인다(0.2.2).
- **끌어 옮기다 세션이 화면에서 사라지면 죽은 게 아니라 떼어진 채 남은 것이다.** `hc ls`엔 보이고, `hc get <t> --json`으로 보면 `keep:false`에 `herdr.space` 이름표가 없다. 되살리기: ① `herdr-app do space.select '{"id":"<공간 id>"}'` ② `herdr-app do terminal.keep '{"terminal":"<t>","place":"tab"}'` ③ `tab.rename`으로 탭 이름 되돌리기. 공간 id는 같은 공간에 있는 다른 세션의 `herdr.space` 이름표에서 알 수 있다.
- **Ctrl+N은 앱이 먼저 받는다**(터미널 안에서도) → Claude 입력 기록 이동은 ↓ 키로. Ctrl+N이 이미 다른 동작에 걸려 있으면 설치가 멈춘다. 한 번 안 먹다가 앱 창을 선택하고 다시 누르니 된 사례가 있다(원인 미확인, 한/영 상태일 수 있음).
- ccd 탭은 **공간(space)의 폴더**에서 열린다(PowerShell `ccd` 함수를 부르지 않음 — herdr는 bash/zsh 함수만 설치 확인을 해서 PowerShell 함수는 "not installed"로 보임).
- 그림 붙여넣기: 앱은 Windows 로컬 창에 클립보드 **글자만** 붙인다. mod가 `clipimg.exe`(설치 때 .NET Framework 4 `csc.exe`로 빌드, 인터넷 안 씀)로 그림을 `C:\Users\Public\herdr-paste\paste-*.png`에 저장하고 클립보드를 '복사한 파일'로 바꾼 뒤 `terminal.paste` → 경로가 들어가고 Claude가 그림으로 읽는다. 원격 창이면 바로 `terminal.paste`(앱이 그림을 그 기기로 복사). 붙인 뒤 클립보드엔 그림 대신 파일이 남는다. Claude 자체 Alt+V는 PowerShell을 띄워 느려서 안 쓴다.
- 원래 단축키 설정은 `keys.json.bak-imagepaste`·`keys.json.bak-ccdkey`로 백업된다. 화면이 망가지면 앱에서 `Ctrl+Alt+Shift+Esc`(기본 화면 복귀).
- 왼쪽 Agents에 안 보이는 Claude 탭 = 백그라운드로 돌던 세션을 `/resume`으로 연 경우 → `claude stop <id>` 후 그 탭에서 `claude --resume`.
- `Alt+위/아래`는 Agents 목록 순서, `Ctrl+PageUp/PageDown`은 상단 탭 순서다(버그 아님).
- 설정 폴더 `~/.config/herdr-app/`(`AGENTS.md`가 앱 전체 설명서 — 단축키 규칙은 「Keys」 절).

## 6. 서버 상주 탭 이름 동기화 — `$K/server/`

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

### '끝남' → '쉬는 중'
엔진 상태 `done` = "사용자가 안 보는 사이 끝남". 앱은 화면마다 '봤음'을 따로 기록해(`~/.config/herdr-app/seen.json`) idle로 바꾸고 엔진 상태는 `done`으로 남는다. 다른 화면(웹 등)이 같이 '봤음'을 공유하려면 엔진 문서에 따로 기록해야 한다.

## 점검 순서 (안 될 때)

1. `hc machine ls` — connected인가 (방향 확인: 어느 쪽에서 add 했나)
2. `ssh -o BatchMode=yes <호스트> "echo ok"` — SSH 자체
3. `hc ls` — 세션이 보이나 / 앱엔 안 보이면 4절 이름표
4. `herdr-app status` — mod·레이아웃 오류, 10061이면 앱 재시작(5절)
5. `python "$K/desktop/setup.py" --check` — 커스텀 칸·단축키 상태
