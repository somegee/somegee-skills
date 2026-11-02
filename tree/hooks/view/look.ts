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

/** 활동별 [바탕색, 띠 한가운데 색]. 그 사이는 섞어서 만든다. */
const SHIMMER: Record<TouchKind, readonly [string, string]> = {
  read: ['#a78bfa', '#f5f3ff'],
  write: ['#f59e42', '#fff3e0'],
  commit: ['#4fb477', '#ecfdf3'],
}

/**
 * 1초에 2번만 다시 그리므로 띠를 넓고 부드럽게 한다: 한 장면에 2칸씩 움직이는데,
 * 띠 반지름이 6칸이라 앞 장면과 많이 겹쳐 뚝뚝 끊겨 보이지 않는다.
 */
export const SHIMMER_STEP_MS = 250
const SHIMMER_RADIUS = 6
/** 색 단계 수: 같은 단계 글자는 한 조각으로 묶인다. */
const SHIMMER_LEVELS = 6
/** 띠가 이름을 다 지나간 뒤 다음 물결까지 비우는 칸. */
const SHIMMER_GAP = SHIMMER_RADIUS * 2

function mix(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const ch = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t))
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

/** 띠 한가운데로부터 거리 d 칸의 밝기 단계(0 = 바탕, SHIMMER_LEVELS-1 = 한가운데). 코사인으로 부드럽게 줄어든다. */
function levelAt(d: number): number {
  const t = Math.max(0, 1 - d / SHIMMER_RADIUS)
  const eased = (1 - Math.cos(Math.PI * t)) / 2
  return Math.round(eased * (SHIMMER_LEVELS - 1))
}

export function shimmerTone(kind: TouchKind, level: number): string {
  const [base, peak] = SHIMMER[kind]
  return level <= 0 ? base : mix(base, peak, level / (SHIMMER_LEVELS - 1))
}

export type Part = { text: string; color: string; bold: boolean }

/**
 * 이름(text) 을 글자별 색 조각으로 나눈다. 뒤쪽 빈칸(자리 맞춤)은 칠하지 않는다.
 * 같은 색이 이어지는 글자는 한 조각으로 묶어 Text 수를 줄인다.
 */
export function shimmerParts(text: string, kind: TouchKind, elapsedMs: number): Part[] {
  const body = text.replace(/\s+$/, '')
  const pad = text.slice(body.length)
  const chars = [...body]
  const cycle = chars.length + SHIMMER_GAP
  const head = (Math.floor(elapsedMs / SHIMMER_STEP_MS) % cycle) - SHIMMER_RADIUS
  const parts: Part[] = []
  chars.forEach((ch, i) => {
    const color = shimmerTone(kind, levelAt(Math.abs(i - head)))
    const last = parts[parts.length - 1]
    if (last && last.color === color) parts[parts.length - 1] = { ...last, text: last.text + ch }
    else parts.push({ text: ch, color, bold: true })
  })
  if (pad) parts.push({ text: pad, color: shimmerTone(kind, 0), bold: false })
  return parts
}
