// Ctrl+N(keys.json "ccd-key.new") → 지금 공간에 claude --dangerously-skip-permissions 새 탭.
// keys.json 만으로는 tab.new 에 argv 를 넘길 수 없어서 이 mod 가 받아서 연다. 화면에는 아무것도 안 그린다.
// 탭 이름은 비워 둔다 → 상단엔 「Claude Code」(my-tabs), 첫 대화 뒤 Claude 제목으로 바뀜(title-sync).
import { View, div } from "gpui-kit";
import { spaces, run, nextCommand } from "herdr";

const ARGV = ["claude", "--dangerously-skip-permissions"];

export default class CcdKey extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "new") continue;
        const space = spaces().find((s) => s.active);
        run("tab.new", { space: space?.id, argv: ARGV });
      }
    });
  }

  render() {
    return div().size_full();
  }
}
