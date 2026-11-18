// Ctrl+Shift+V 그림 붙여넣기 — 로컬 Windows 창도 되게 (2026-11-03)
// 앱은 Windows 로컬 창에 클립보드 '글자'만 붙인다. 그래서 로컬 창이면 먼저 clipimg.exe 가
// 클립보드 그림을 PNG로 저장하고 클립보드를 '복사한 파일'로 바꾼다 → 앱의 terminal.paste 가
// 끌어다 놓은 것처럼 경로를 넣고, Claude 가 그 경로를 그림으로 읽는다.
// (Claude 자체 Alt+V 는 PowerShell 로 클립보드를 읽어 느려서 안 씀)
// 다른 기기 창이면 그대로 terminal.paste (앱이 그림을 그 기기로 복사하고 경로를 붙임).
// keys.json: "terminal": { "ctrl-shift-v": "image-paste.paste" }
import { View, div } from "gpui-kit";
import { focused, spaces, exec, run, appHome, nextCommand, notify } from "herdr";

const NO_IMAGE = 2;

function isLocal(f) {
  const space = spaces().find((s) => s.id === f.space);
  if (space && space.machine) return false;
  return !(f.terminal ?? "").includes("/");
}

async function paste() {
  const f = focused();
  if (f && f.terminal && isLocal(f)) {
    const r = await exec(`${appHome()}/mods/image-paste/clipimg.exe`, []);
    if (r.code !== 0 && r.code !== NO_IMAGE) {
      notify({ title: "그림 저장 실패", body: (r.stderr || "").slice(0, 200), level: "warning" });
    }
  }
  run("terminal.paste");
}

export default class ImagePaste extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "paste") continue;
        try {
          await paste();
        } catch (e) {
          notify({ title: "그림 붙여넣기 실패", body: String(e).slice(0, 200), level: "warning" });
          run("terminal.paste");
        }
      }
    });
  }

  render() {
    return div().size_full();
  }
}
