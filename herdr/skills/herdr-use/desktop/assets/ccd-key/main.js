// Ctrl+N(keys.json "ccd-key.new") → claude --dangerously-skip-permissions 새 탭.
// keys.json 만으로는 tab.new 에 argv 를 넘길 수 없어서 이 mod 가 받아서 연다. 화면에는 아무것도 안 그린다.
// 탭 이름은 비워 둔다 → 상단엔 「Claude Code」(my-tabs), 첫 대화 뒤 Claude 제목으로 바뀜(title-sync).
// 폴더: 설치 때 --ccd-folder 로 정한 폴더. 안 정했거나 다른 기기(원격) 공간이면 그 공간의 폴더.
import { View, div } from "gpui-kit";
import { spaces, run, nextCommand, exec, notify, window } from "herdr";

const ARGV = ["claude", "--dangerously-skip-permissions"];
const FOLDER = "";  // 설치 스크립트가 --ccd-folder 값으로 채운다. "" 이면 공간 폴더
const PROBE_TIMEOUT_MS = 5000;

// 설치 뒤 폴더가 지워졌을 수 있다. run() 은 null 을 돌려줘 tab.new 실패를 알 수 없으므로 미리 본다
// (exec 는 cwd 폴더가 없으면 거절한다).
async function folderOk(folder) {
  const [cmd, args] = window()?.platform === "windows" ? ["cmd", ["/c", "exit"]] : ["true", []];
  try {
    await exec(cmd, args, { cwd: folder, timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export default class CcdKey extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "new") continue;
        const space = spaces().find((s) => s.active);
        const base = { space: space?.id, argv: ARGV };
        const ok = FOLDER && !space?.machine ? await folderOk(FOLDER) : null;
        if (ok === false) notify({ title: "ccd 폴더가 없음", body: FOLDER + " — 공간 폴더에서 엽니다. setup.py --ccd-folder 로 다시 지정", level: "warning" });
        run("tab.new", ok ? { ...base, folder: FOLDER } : base);
      }
    });
  }

  render() {
    return div().size_full();
  }
}
