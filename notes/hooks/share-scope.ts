import type { NoteTab } from '../types'

// 노트를 어느 세션끼리 함께 보는지. /config 의 notes.shareScope, 기본은 전체.
// 전체 = 이 PC 의 모든 세션(작업 폴더 상관없이), 같은 폴더 = 같은 작업 폴더의 세션끼리, 세션마다 = 공유 안 함.
export const SHARE_SCOPES = ['전체', '같은 폴더', '세션마다'] as const
export type ShareScope = (typeof SHARE_SCOPES)[number]
export const toShareScope = (value: unknown): ShareScope =>
  SHARE_SCOPES.includes(value as ShareScope) ? (value as ShareScope) : '전체'

// 전체 공유 파일. 폴더별 파일 이름은 영문·숫자·- 만 쓰므로 _ 로 시작하는 이 이름과 겹치지 않는다.
export const SHARED_FILE = '_all.json'
export const SESSION_DIR = 'sessions'

// notes-data 폴더 안에서 노트 파일의 상대 경로.
export const noteFileName = (scope: ShareScope, root: string, sessionId: string) => {
  if (scope === '전체') return SHARED_FILE
  if (scope === '세션마다') return `${SESSION_DIR}/${sessionId.replace(/[^A-Za-z0-9-]/g, '')}.json`
  return `${root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`
}

// 처음 전체 공유로 바꿨을 때 폴더별 노트를 한 파일로 모은다. 이름이 같은 탭은 더 최근에 고친 쪽을 남기고,
// 오래된 것부터 늘어놓아 최근 max 개만 둔다.
export function mergeTabs(lists: NoteTab[][], max: number): NoteTab[] {
  const byTitle = new Map<string, NoteTab>()
  for (const tab of lists.flat()) {
    const kept = byTitle.get(tab.title)
    if (kept === undefined || (Date.parse(tab.updatedAt) || 0) > (Date.parse(kept.updatedAt) || 0)) byTitle.set(tab.title, tab)
  }
  return [...byTitle.values()].sort((x, y) => (Date.parse(x.updatedAt) || 0) - (Date.parse(y.updatedAt) || 0)).slice(-max)
}
