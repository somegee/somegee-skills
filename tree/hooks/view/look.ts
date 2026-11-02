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

