// 창에서 누른 것과 Claude 의 작업이 상태를 바꾸는 곳.
import type { EngineInterface, RenderSurface } from 'claude-code'

import type { DiffFile, Entry, Mode, TouchKind } from '../types'
import type { Config } from './config'
import { dropIndex, listDir, measure, openPath, searchFiles } from './fsx'
import { addedDiff, diffOf, loadGit, reposTouching } from './git'
import { ancestorsWithin, baseName, idOf, isBinaryName, isMarkdownName, isUnder, join, nativePath, norm, parentOf, relativeTo } from './paths'
import {
  editListings,
  editOpened,
  editRecent,
  editTouches,
  readGit,
  readListings,
  readOpened,
  readPreview,
  readRoot,
  readSelected,
  writeGit,
  writeMap,
  writeMode,
  writePreview,
  writeQuery,
  writeResults,
  writeRoot,
  writeSelected,
} from './state'

export const PANE = 'tree'

/** 활동 표시가 진하게 남는 시간. 지나면 흐려지고 TOUCH_KEEP_MS 뒤에 지운다. */
export const TOUCH_FRESH_MS = 8_000
const TOUCH_KEEP_MS = 60_000

const PREVIEW_BYTES = 1_000_000
const PREVIEW_LINES = 1500
const PREVIEW_CHARS = 90_000

// ── 폴더 목록 ──

export async function rootOf($: EngineInterface): Promise<string> {
  const stored = await readRoot($)
  if (stored) return stored
  const root = norm(await $.session.root())
  await writeRoot($, root)
  return root
}

function sameList(a: readonly Entry[] | undefined, b: readonly Entry[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((one, i) => one.name === b[i]?.name && one.isDir === b[i]?.isDir && one.size === b[i]?.size)
}

/** 루트와 펼친 폴더를 다시 읽는다. 바뀐 것이 있을 때만 쓴다(안 바뀌면 다시 그리지 않음). */
export async function refreshListings($: EngineInterface): Promise<boolean> {
  const root = await rootOf($)
  const opened = await readOpened($)
  const before = await readListings($)
  const dirs = [root, ...opened.filter(dir => isUnder(root, dir))]
  const fresh: Record<string, readonly Entry[]> = {}
  let isChanged = Object.keys(before).length !== dirs.length
  for (const dir of dirs) {
    const list = await listDir($, dir)
    fresh[idOf(dir)] = list
    if (!sameList(before[idOf(dir)], list)) isChanged = true
  }
  if (!isChanged) return false
  await editListings($, () => fresh)
  dropIndex()
  return true
}

async function openDir($: EngineInterface, dir: string): Promise<void> {
  const list = await listDir($, dir)
  await editListings($, all => ({ ...all, [idOf(dir)]: list }))
  await editOpened($, cur => (cur.some(one => idOf(one) === idOf(dir)) ? cur : [...cur, norm(dir)]))
}

export async function toggleDir($: EngineInterface, dir: string): Promise<void> {
  const opened = await readOpened($)
  if (opened.some(one => idOf(one) === idOf(dir))) {
    // 접으면 그 아래 펼쳐 둔 폴더도 같이 접는다
    await editOpened($, cur => cur.filter(one => !isUnder(dir, one)))
    return
  }
  await openDir($, dir)
}

/** 트리에서 그 경로까지 폴더를 펼친다. scroll 이면 그 줄이 보이게 옮긴다. */
export async function reveal($: EngineInterface, path: string, scroll: boolean): Promise<void> {
  const root = await rootOf($)
  if (!isUnder(root, path) || idOf(root) === idOf(path)) return
  const opened = await readOpened($)
  for (const dir of ancestorsWithin(root, path)) {
    if (!opened.some(one => idOf(one) === idOf(dir))) await openDir($, dir)
  }
  if (scroll) await $.ui.scroll({ to: { key: rowKey(path) }, in: PANE, block: 'center' }).catch(() => undefined)
}

/** 읽어 둔 목록으로 그 경로가 폴더인지 본다. */
export function isDirIn(listings: Record<string, readonly Entry[]>, path: string): boolean {
  const name = baseName(path)
  return (listings[idOf(parentOf(path))] ?? []).some(one => one.isDir && one.name === name)
}

export function rowKey(path: string): string {
  return `row:${idOf(path)}`
}

// ── 줄 누르기 ──

/** 폴더는 펼치거나 접으며 고르고, 파일은 고른다. 고른 줄을 다시 누르면 고르기를 푼다. */
export async function pressRow($: EngineInterface, path: string, isDir: boolean): Promise<void> {
  const current = await readSelected($)
  if (isDir) {
    await toggleDir($, path)
    void refreshGit($).catch(() => undefined) // 펼친 폴더 안 저장소도 추적하도록
  }
  const isSame = current !== null && idOf(current) === idOf(path)
  await writeSelected($, isSame && !isDir ? null : norm(path))
}

/** 검색 결과·최근 작업·변경 목록에서 누른 것: 트리로 돌아가 그 자리를 보여 주고 고른다. */
export async function jumpTo($: EngineInterface, path: string): Promise<void> {
  await writeMode($, 'tree')
  await writeQuery($, '')
  await writeResults($, null)
  await writeSelected($, norm(path))
  await reveal($, path, true)
}

export async function setMode($: EngineInterface, mode: Mode): Promise<void> {
  await writePreview($, null)
  await writeMode($, mode)
  if (mode === 'changes') void refreshGit($)
  if (mode === 'map') {
    const selected = await readSelected($)
    const listings = await readListings($)
    const root = await rootOf($)
    await showMap($, selected !== null && isDirIn(listings, selected) ? selected : root)
  }
  await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
}

export async function copyPath($: EngineInterface, path: string, surface?: RenderSurface): Promise<void> {
  const text = nativePath(path)
  const done = await $.ui.copy({ text, ...(surface ? { surface } : {}) }).catch(() => ({ isCopied: false }))
  $.ui.toast(done.isCopied ? `경로를 복사했습니다: ${text}` : `경로를 복사하지 못했습니다: ${baseName(path)}`)
}

export async function openItem($: EngineInterface, path: string): Promise<void> {
  const isOpened = await openPath($, path)
  if (!isOpened) $.ui.toast(`열지 못했습니다: ${baseName(path)}`)
}

// ── 검색 ──

export async function runSearch($: EngineInterface, text: string): Promise<void> {
  const q = text.trim()
  await writeQuery($, q)
  if (!q) {
    await writeResults($, null)
    return
  }
  await writeResults($, await searchFiles($, await rootOf($), q))
  await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
}

export async function clearSearch($: EngineInterface): Promise<void> {
  await writeQuery($, '')
  await writeResults($, null)
}

// ── 미리보기·바뀐 내용·크기 그림 ──

export async function showPreview($: EngineInterface, path: string): Promise<void> {
  const full = norm(path)
  const stat = await $.fs.stat(full).catch(() => null)
  if (!stat) {
    await writePreview($, { kind: 'note', path: full, note: '파일이 없습니다.' })
  } else if (isBinaryName(full)) {
    await writePreview($, { kind: 'note', path: full, note: '그림·문서·압축 같은 파일은 글자로 보여 줄 수 없습니다. [열기]로 기본 프로그램에서 여세요.' })
  } else if (stat.size > PREVIEW_BYTES) {
    await writePreview($, { kind: 'note', path: full, note: `파일이 너무 큽니다(1MB 넘음). [열기]로 여세요.` })
  } else {
    const text = await $.fs.read(full).catch(() => null)
    if (text === null || text.slice(0, 8000).includes('\u0000')) {
      await writePreview($, { kind: 'note', path: full, note: '글자 파일이 아니라 보여 줄 수 없습니다.' })
    } else {
      const lines = text.replace(/\r\n?/g, '\n').split('\n')
      let shown = lines.slice(0, PREVIEW_LINES).join('\n')
      let note = lines.length > PREVIEW_LINES ? `앞 ${PREVIEW_LINES}줄만 보여 줍니다(전체 ${lines.length}줄).` : ''
      if (shown.length > PREVIEW_CHARS) {
        shown = shown.slice(0, PREVIEW_CHARS)
        note = '앞부분만 보여 줍니다.'
      }
      await writePreview($, { kind: isMarkdownName(full) ? 'markdown' : 'code', path: full, text: shown, note })
    }
  }
  await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
}

export async function showDiff($: EngineInterface, path: string): Promise<void> {
  const root = await rootOf($)
  const git = (await readGit($)) ?? (await loadGit($, root, await innerRepos($)))
  const full = norm(path)
  const tops = git ? reposTouching(git, full) : []
  if (!git || tops.length === 0) {
    await writePreview($, { kind: 'note', path: full, note: 'git 저장소가 아니라 바뀐 내용을 볼 수 없습니다.' })
    return
  }
  const files: DiffFile[] = []
  // 제목은 루트 기준 경로로(안쪽 저장소가 여럿이어도 어디 파일인지 보이게)
  const titled = (top: string, f: DiffFile): DiffFile => ({ ...f, title: relativeTo(root, join(top, f.title)) || f.title })
  for (const top of tops.slice(0, REPO_LIMIT)) {
    const scope = isUnder(top, full) ? full : top
    for (const f of (await diffOf($, top, scope)) ?? []) files.push(titled(top, f))
  }
  // git 이 아직 모르는 새 파일은 diff 에 안 나오므로 내용을 '전부 추가'로 붙인다
  const fresh = Object.entries(git.files).filter(([id, code]) => code === '?' && isUnder(full, id))
  for (const [id] of fresh.slice(0, 20)) {
    const abs = git.paths[id] ?? id
    if (isBinaryName(abs)) continue
    const text = await $.fs.read(abs).catch(() => null)
    if (text !== null && text.length < PREVIEW_CHARS) files.push(addedDiff(relativeTo(root, abs) || abs, text))
  }
  const note = files.length === 0 ? '바뀐 내용이 없습니다(마지막 커밋과 같음).' : ''
  await writePreview($, { kind: 'diff', path: full, files, note })
  await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
}

export async function closePreview($: EngineInterface): Promise<void> {
  const shown = await readPreview($)
  await writePreview($, null)
  if (shown) await $.ui.scroll({ to: { key: rowKey(shown.path) }, in: PANE, block: 'center' }).catch(() => undefined)
}

export async function showMap($: EngineInterface, dir: string): Promise<void> {
  const full = norm(dir)
  await writeMap($, { dir: full, total: 0, tiles: [], isPartial: false, isLoading: true })
  const { tiles, isPartial } = await measure($, full)
  const total = tiles.reduce((sum, t) => sum + t.size, 0)
  await writeMap($, { dir: full, total, tiles, isPartial, isLoading: false })
}

// ── git ──

const REPO_LIMIT = 20

/**
 * 트리에 보이는 폴더(루트 바로 아래 + 펼친 폴더 바로 아래) 중 안쪽 저장소(.git 이 있는 폴더).
 * 펼친 폴더 안만 보므로 저장소가 많아도 갱신이 무거워지지 않는다.
 */
export async function innerRepos($: EngineInterface): Promise<string[]> {
  const root = await rootOf($)
  const listings = await readListings($)
  const opened = await readOpened($)
  const parents = [root, ...opened.filter(dir => isUnder(root, dir))]
  const candidates: string[] = []
  for (const dir of parents) {
    for (const one of listings[idOf(dir)] ?? []) if (one.isDir) candidates.push(join(dir, one.name))
  }
  const found: string[] = []
  for (const dir of candidates) {
    if (found.length >= REPO_LIMIT) break
    if (await $.fs.exists(join(dir, '.git')).catch(() => false)) found.push(dir)
  }
  return found
}

let gitRun: Promise<void> | null = null
let gitAgain = false

/** git 상태를 다시 읽는다. 읽는 중에 또 부르면 끝난 뒤 한 번만 더 읽는다. */
export function refreshGit($: EngineInterface): Promise<void> {
  if (gitRun) {
    gitAgain = true
    return gitRun
  }
  gitRun = (async () => {
    do {
      gitAgain = false
      const git = await loadGit($, await rootOf($), await innerRepos($)).catch(() => null)
      await writeGit($, git)
    } while (gitAgain)
  })().finally(() => {
    gitRun = null
  })
  return gitRun
}

// ── Claude 의 작업 표시 ──

/** 마지막 활동 시각: 물결 반짝임을 그리는 동안만 빠른 타이머가 다시 그리게 한다. */
let lastTouchAt = 0

export function isShimmering(now: number): boolean {
  return now - lastTouchAt < TOUCH_FRESH_MS
}

/** 파일들에 활동 표시를 단다. reveal 이면 트리에서 그 자리를 펼쳐 보여 준다. */
export async function touch($: EngineInterface, paths: readonly string[], kind: TouchKind, follow: boolean): Promise<void> {
  if (paths.length === 0) return
  const root = await rootOf($)
  const now = Date.now()
  const inside = paths.map(norm).filter(path => isUnder(root, path))
  if (inside.length === 0) return
  lastTouchAt = now
  await editTouches($, all => {
    const kept: Record<string, { kind: TouchKind; at: number }> = {}
    for (const [id, t] of Object.entries(all)) if (now - t.at < TOUCH_KEEP_MS) kept[id] = t
    for (const path of inside) kept[idOf(path)] = { kind, at: now }
    return kept
  })
  if (follow) {
    const first = inside[0]
    for (const path of inside.slice(0, 5)) await reveal($, path, false)
    if (first) await $.ui.scroll({ to: { key: rowKey(first) }, in: PANE, block: 'nearest' }).catch(() => undefined)
  }
}

/** Claude 가 만들거나 고친 파일을 '최근 작업'에 올린다(만든 뒤 고친 파일은 '만듦'으로 남긴다). */
export async function remember($: EngineInterface, path: string, isNew: boolean, config: Config): Promise<void> {
  const full = norm(path)
  await editRecent($, list => {
    const before = list.find(one => idOf(one.path) === idOf(full))
    const kind = before?.kind === 'new' || isNew ? 'new' : 'edit'
    return [{ path: full, kind, at: Date.now() } as const, ...list.filter(one => idOf(one.path) !== idOf(full))].slice(0, config.recentLimit)
  })
}

export async function forgetRecent($: EngineInterface): Promise<void> {
  await editRecent($, () => [])
}
