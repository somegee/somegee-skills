// Claude 창 제목(/rename 한 세션 이름)이 바뀌면 그 탭 이름을 같이 바꾼다.
// 로컬·원격(서버) 창 모두 이 PC 앱에서 처리한다. 화면에는 아무것도 그리지 않는다.
import { View, div } from "gpui-kit";
import { panes, spaces, run } from "herdr";

const CHECK_MS = 2000;
const IGNORED = new Set(["", "claude code", "claude"]);
// Claude가 제목 앞에 붙이는 진행 표시(✳, 점자 스피너 등)를 떼어 낸다.
const LEADING_MARKS = /^[^\p{L}\p{N}]+/u;

function cleanTitle(raw) {
  return (raw ?? "").replace(LEADING_MARKS, "").trim();
}

export default class TitleSync extends View {
  init(_props, cx) {
    this.seen = new Map(); // terminal -> 마지막으로 본 제목
    this.sync();
    cx.timer.every(CHECK_MS, () => this.sync());
  }

  tabsById() {
    const map = new Map();
    for (const s of spaces()) for (const t of s.tabs) map.set(t.id, t);
    return map;
  }

  sync() {
    const tabs = this.tabsById();
    const claudeByTab = new Map();
    for (const p of panes()) {
      if (!p.terminal || p.app !== "claude-code") continue;
      const list = claudeByTab.get(p.tab) ?? [];
      list.push(p);
      claudeByTab.set(p.tab, list);
    }
    for (const [tabId, list] of claudeByTab) {
      if (list.length !== 1) continue; // Claude 창이 여럿인 탭은 건드리지 않는다
      const pane = list[0];
      const title = cleanTitle(pane.title);
      const prev = this.seen.get(pane.terminal);
      this.seen.set(pane.terminal, title);
      if (IGNORED.has(title.toLowerCase())) continue;
      const tab = tabs.get(tabId);
      if (!tab || tab.name === title) continue;
      const changed = prev !== undefined && prev !== title;
      // 처음 본 창은 아무도 이름 안 붙인 탭일 때만, 그 뒤엔 제목이 바뀔 때마다.
      if (changed || (prev === undefined && !tab.named)) {
        run("tab.rename", { id: tabId, name: title });
      }
    }
  }

  render() {
    return div().size_full();
  }
}
