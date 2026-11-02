// 창이 읽는 값(atom). 읽기·쓰기는 이 파일 안의 함수로만 한다:
// 검사기가 read/update 의 대상을 같은 파일의 atom 으로만 받는다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Entry, GitInfo, GitOp, MapData, Mode, Preview, Recent, Touch } from '../types'

const root = atom({ plugin: 'tree', key: 'root' } as const, '')
const mode = atom({ plugin: 'tree', key: 'mode' } as const, 'tree')
const opened = atom({ plugin: 'tree', key: 'opened' } as const, [])
const listings = atom({ plugin: 'tree', key: 'listings' } as const, {})
const selected = atom({ plugin: 'tree', key: 'selected' } as const, null)
const query = atom({ plugin: 'tree', key: 'query' } as const, '')
const results = atom({ plugin: 'tree', key: 'results' } as const, null)
const git = atom({ plugin: 'tree', key: 'git' } as const, null)
const touches = atom({ plugin: 'tree', key: 'touches' } as const, {})
const gitOp = atom({ plugin: 'tree', key: 'gitOp' } as const, null)
const recent = atom({ plugin: 'tree', key: 'recent' } as const, [])
const preview = atom({ plugin: 'tree', key: 'preview' } as const, null)
const map = atom({ plugin: 'tree', key: 'map' } as const, null)
const tick = atom({ plugin: 'tree', key: 'tick' } as const, 0)

export function readRoot($: EngineInterface): Promise<string> {
  return read($, root)
}
export async function writeRoot($: EngineInterface, value: string): Promise<void> {
  await update($, root, () => value)
}

export function readMode($: EngineInterface): Promise<Mode> {
  return read($, mode)
}
export async function writeMode($: EngineInterface, value: Mode): Promise<void> {
  await update($, mode, () => value)
}

export function readOpened($: EngineInterface): Promise<readonly string[]> {
  return read($, opened)
}
export async function editOpened($: EngineInterface, fn: (list: readonly string[]) => readonly string[]): Promise<void> {
  await update($, opened, fn)
}

export function readListings($: EngineInterface): Promise<Record<string, readonly Entry[]>> {
  return read($, listings)
}
export async function editListings(
  $: EngineInterface,
  fn: (all: Record<string, readonly Entry[]>) => Record<string, readonly Entry[]>,
): Promise<void> {
  await update($, listings, fn)
}

export function readSelected($: EngineInterface): Promise<string | null> {
  return read($, selected)
}
export async function writeSelected($: EngineInterface, value: string | null): Promise<void> {
  await update($, selected, () => value)
}

export function readQuery($: EngineInterface): Promise<string> {
  return read($, query)
}
export async function writeQuery($: EngineInterface, value: string): Promise<void> {
  await update($, query, () => value)
}

export function readResults($: EngineInterface): Promise<readonly string[] | null> {
  return read($, results)
}
export async function writeResults($: EngineInterface, value: readonly string[] | null): Promise<void> {
  await update($, results, () => value)
}

export function readGit($: EngineInterface): Promise<GitInfo | null> {
  return read($, git)
}
export async function writeGit($: EngineInterface, value: GitInfo | null): Promise<void> {
  await update($, git, () => value)
}

export function readTouches($: EngineInterface): Promise<Record<string, Touch>> {
  return read($, touches)
}
export async function editTouches($: EngineInterface, fn: (all: Record<string, Touch>) => Record<string, Touch>): Promise<void> {
  await update($, touches, fn)
}

export function readGitOp($: EngineInterface): Promise<GitOp | null> {
  return read($, gitOp)
}
export async function writeGitOp($: EngineInterface, value: GitOp | null): Promise<void> {
  await update($, gitOp, () => value)
}

export function readRecent($: EngineInterface): Promise<readonly Recent[]> {
  return read($, recent)
}
export async function editRecent($: EngineInterface, fn: (list: readonly Recent[]) => readonly Recent[]): Promise<void> {
  await update($, recent, fn)
}

export function readPreview($: EngineInterface): Promise<Preview | null> {
  return read($, preview)
}
export async function writePreview($: EngineInterface, value: Preview | null): Promise<void> {
  await update($, preview, () => value)
}

export function readMap($: EngineInterface): Promise<MapData | null> {
  return read($, map)
}
export async function writeMap($: EngineInterface, value: MapData | null): Promise<void> {
  await update($, map, () => value)
}

export function readTick($: EngineInterface): Promise<number> {
  return read($, tick)
}
export async function bumpTick($: EngineInterface): Promise<void> {
  await update($, tick, n => (n + 1) % 1_000_000)
}
