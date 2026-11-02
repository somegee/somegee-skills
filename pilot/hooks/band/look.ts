// 막대의 색·글자 폭. 색은 statusline.py 의 256색을 hex 로 옮겼다.
import type { ElementTable } from 'claude-code'

export type Els = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>

export const C = {
  effort: '#d7afff',
  warn: '#ffaf5f',
  hot: '#ff5f5f',
  cold: '#5f87af',
  accent: '#af87ff',
  // notes 와 같은 터미널 팔레트 색: 터미널 테마를 따라간다.
  border: 'cyan',
} as const

/** 테두리 양옆 1칸 + 안쪽 여백 양옆 1칸. */
export const FRAME_CELLS = 4

// 터미널에서 두 칸을 차지하는 글자(한글·한자·가나·전각).
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** 터미널 칸 수. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += WIDE.test(ch) ? 2 : 1
  return n
}
