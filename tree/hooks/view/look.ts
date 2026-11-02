// 창의 색·기호·버튼 동작 묶음.
import type { ElementTable, EngineInterface, RenderSurface } from 'claude-code'

import type { Mode, TouchKind } from '../../types'

export type Els = ElementTable<'terminal'>

export const C = {
  /** Claude Code 테마의 강조색(고른 줄·탭). */
  accent: 'suggestion',
  read: '#a78bfa',
  write: '#f59e42',
  commit: '#4fb477',
  added: 'green',
  modified: 'yellow',
  deleted: 'red',
  renamed: 'cyan',
  failed: '#e06c75',
} as const

export const TOUCH_COLOR: Record<TouchKind, string> = { read: C.read, write: C.write, commit: C.commit }

export function gitColor(code: string): string {
  if (code === '?' || code === 'A') return C.added
  if (code === 'D' || code === 'U') return C.deleted
  if (code === 'R') return C.renamed
  return C.modified
}

/** 목록 오른쪽 끝 표시 칸의 폭: 빈칸 + Claude 표시(+·~) + git 표시. */
export const MARK_CELLS = 3

/** 버튼이 하는 일. 화면 함수는 이것만 받는다($ 를 직접 만지지 않는다). */
export type Acts = {
  press: (path: string, isDir: boolean) => void
  jump: (path: string) => void
  open: (path: string) => void
  copy: (path: string, surface: RenderSurface) => void
  preview: (path: string) => void
  diff: (path: string) => void
  map: (dir: string) => void
  closePreview: () => void
  mode: (mode: Mode) => void
  search: (text: string) => void
  clearSearch: () => void
  forget: () => void
  refresh: () => void
}


// ── 물결 반짝임: Claude 가 만지는 파일 이름 위로 밝은 띠가 흐른다 ──

/** 활동별 색 단계: [바탕, 띠 가장자리, 띠 안쪽, 띠 한가운데]. */
const SHIMMER: Record<TouchKind, readonly [string, string, string, string]> = {
  read: ['#a78bfa', '#c4b5fd', '#ddd6fe', '#f5f3ff'],
  write: ['#f59e42', '#fbbf72', '#fdd9a8', '#fff3e0'],
  commit: ['#4fb477', '#7ccf9a', '#b0e6c4', '#ecfdf3'],
}

/** 띠가 한 칸 움직이는 시간과 띠의 반지름(칸). */
export const SHIMMER_STEP_MS = 45
const SHIMMER_RADIUS = 3
/** 띠가 이름을 다 지나간 뒤 다음 물결까지 비우는 칸. */
const SHIMMER_GAP = 10

export type Part = { text: string; color: string; bold: boolean }

/**
 * 이름(text) 을 글자별 색 조각으로 나눈다. 뒤쪽 빈칸(자리 맞춤)은 칠하지 않는다.
 * 같은 색이 이어지는 글자는 한 조각으로 묶어 Text 수를 줄인다.
 */
export function shimmerParts(text: string, kind: TouchKind, elapsedMs: number): Part[] {
  const tones = SHIMMER[kind]
  const body = text.replace(/\s+$/, '')
  const pad = text.slice(body.length)
  const chars = [...body]
  const cycle = chars.length + SHIMMER_GAP
  const head = Math.floor(elapsedMs / SHIMMER_STEP_MS) % cycle - SHIMMER_RADIUS
  const parts: Part[] = []
  chars.forEach((ch, i) => {
    const d = Math.abs(i - head)
    const level = d === 0 ? 3 : d === 1 ? 2 : d <= SHIMMER_RADIUS - 1 ? 1 : 0
    const color = tones[level] ?? tones[0]
    const last = parts[parts.length - 1]
    if (last && last.color === color) parts[parts.length - 1] = { ...last, text: last.text + ch }
    else parts.push({ text: ch, color, bold: true })
  })
  if (pad) parts.push({ text: pad, color: tones[0], bold: false })
  return parts
}
