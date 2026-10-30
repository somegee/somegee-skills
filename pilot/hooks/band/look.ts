// 막대의 색·아이콘·글자 폭. 색은 statusline.py 의 256색을 hex 로 옮겼다.
import type { ElementTable } from 'claude-code'

export type Els = Pick<ElementTable<'terminal'>, 'Box' | 'Text' | 'Button'>

export const C = {
  folder: '#ffd75f',
  branch: '#afd787',
  model: '#af87ff',
  effort: '#d7afff',
  context: '#afffd7',
  warn: '#ffaf5f',
  hot: '#ff5f5f',
  version: '#b2b2b2',
  cache: '#87d7ff',
  cold: '#5f87af',
  limit: '#d7d7af',
  accent: '#af87ff',
  // notes 와 같은 터미널 팔레트 색: 터미널 테마를 따라간다.
  border: 'cyan',
} as const

/** 테두리 양옆 1칸 + 안쪽 여백 양옆 1칸. */
export const FRAME_CELLS = 4

// Nerd Font 아이콘(statusline.py 와 같은 글자). 터미널에서만 쓴다.
export const ICON = {
  folder: '',
  branch: '',
  version: '',
  context: '',
  model: '\u{f06a9}',
} as const

export const SEP = ' │ '

/** 퍼센트에 맞는 색(60% 주황, 80% 빨강). */
export function percentColor(percent: number, base: string): string {
  if (percent >= 80) return C.hot
  if (percent >= 60) return C.warn
  return base
}

/** 남은 분에 맞는 캐시 색. */
export function cacheColor(minutes: number): string {
  if (minutes === 0) return C.cold
  if (minutes < 5) return C.hot
  if (minutes < 20) return C.warn
  return C.cache
}

// 터미널에서 두 칸을 차지하는 글자(한글·한자·가나·전각).
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** 터미널 칸 수. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += WIDE.test(ch) ? 2 : 1
  return n
}
