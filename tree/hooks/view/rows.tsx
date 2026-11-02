// 트리 줄·평평한 목록 줄·고른 줄 아래 버튼 줄.
import type { RenderSurface } from 'claude-code'

import type { Entry, GitInfo, Touch } from '../../types'
import { rowKey } from '../actions'
import { baseName, cells, fit, idOf, isUnder, join, parentOf, relativeTo } from '../paths'
import { C, MARK_CELLS, TOUCH_COLOR, gitColor } from './look'
import type { Acts, Els } from './look'

export type TreeRow = { path: string; name: string; depth: number; isDir: boolean; isOpen: boolean }

/** 펼친 폴더를 따라 트리 줄을 만든다. */
export function buildRows(root: string, listings: Record<string, readonly Entry[]>, openedIds: ReadonlySet<string>): TreeRow[] {
  const out: TreeRow[] = []
  const walk = (dir: string, depth: number) => {
    for (const one of listings[idOf(dir)] ?? []) {
      const path = join(dir, one.name)
      const isOpen = one.isDir && openedIds.has(idOf(path))
      out.push({ path, name: one.name, depth, isDir: one.isDir, isOpen })
      if (isOpen) walk(path, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

/** 줄 표시에 필요한 것들. */
export type Marks = {
  git: GitInfo | null
  /** 바뀐 파일을 품은 폴더(id). */
  dirty: ReadonlySet<string>
  /** Claude 가 만든(+)·고친(~) 파일(id → 표시). */
  recent: ReadonlyMap<string, '+' | '~'>
  /** 진하게 보일 활동(id → 활동). */
  fresh: ReadonlyMap<string, Touch>
  selected: string | null
  width: number
}

/** 바뀐 파일들을 품은 폴더 집합(root 아래만). */
export function dirtyDirs(root: string, git: GitInfo | null): Set<string> {
  const out = new Set<string>()
  if (!git) return out
  for (const id of Object.keys(git.files)) {
    if (!isUnder(root, id)) continue
    let dir = parentOf(id)
    while (isUnder(root, dir) && idOf(dir) !== idOf(root) && !out.has(idOf(dir))) {
      out.add(idOf(dir))
      dir = parentOf(dir)
    }
  }
  return out
}

function freshUnder(dir: string, fresh: ReadonlyMap<string, Touch>): Touch | undefined {
  for (const [id, t] of fresh) if (id !== idOf(dir) && isUnder(dir, id)) return t
  return undefined
}

function markOf(row: { path: string; isDir: boolean }, m: Marks): { claude: string; claudeColor: string; code: string; codeColor: string } {
  const id = idOf(row.path)
  const r = row.isDir ? undefined : m.recent.get(id)
  const code = row.isDir ? (m.dirty.has(id) ? '•' : ' ') : (m.git?.files[id] ?? ' ')
  return {
    claude: r ?? ' ',
    claudeColor: r === '+' ? C.added : C.modified,
    code,
    codeColor: row.isDir ? C.modified : gitColor(code),
  }
}

/** 트리 한 줄(줄 전체가 한 버튼). 고른 줄이면 아래에 버튼 줄이 붙는다. */
export function treeRow(els: Els, row: TreeRow, m: Marks, acts: Acts) {
  const { Box, Text, Button } = els
  const id = idOf(row.path)
  const isSelected = m.selected !== null && idOf(m.selected) === id
  const touch = m.fresh.get(id) ?? (row.isDir && !row.isOpen ? freshUnder(row.path, m.fresh) : undefined)
  // 열린 폴더마다 흐린 세로줄 '│ ' (폭은 빈칸 들여쓰기와 같다)
  const rail = '│ '.repeat(row.depth)
  const caret = row.isDir ? (row.isOpen ? '▾ ' : '▸ ') : '  '
  const gutter = isSelected ? '›' : ' '
  const nameWidth = Math.max(4, m.width - 1 - cells(rail) - cells(caret) - MARK_CELLS)
  const name = fit(row.isDir ? `${row.name}/` : row.name, nameWidth)
  const mark = markOf(row, m)
  const nameColor = isSelected ? C.accent : touch && !row.isDir ? TOUCH_COLOR[touch.kind] : undefined
  return (
    <Box key={rowKey(row.path)} flexDirection="column">
      <Button key={`b:${id}`} plain onPress={() => acts.press(row.path, row.isDir)}>
        <Text color={isSelected ? C.accent : undefined}>{gutter}</Text>
        <Text dimColor>{rail}</Text>
        <Text color={touch && row.isDir ? TOUCH_COLOR[touch.kind] : undefined} dimColor={!touch}>
          {caret}
        </Text>
        <Text color={nameColor} bold={isSelected || Boolean(touch)} dimColor={row.isDir && !isSelected && !touch}>
          {name}
        </Text>
        <Text> </Text>
        <Text color={mark.claudeColor}>{mark.claude}</Text>
        <Text color={mark.codeColor}>{mark.code}</Text>
      </Button>
      {isSelected ? actionBar(els, row.path, row.isDir, m, acts, ` ${rail}${row.isDir && row.isOpen ? '│ ' : '  '}`) : null}
    </Box>
  )
}

/** 고른 줄 아래 버튼 줄: 열기 · 경로 복사 · 미리보기(파일)/크기 그림(폴더) · 바뀐 내용. */
export function actionBar(els: Els, path: string, isDir: boolean, m: Marks, acts: Acts, rail: string) {
  const { Box, Text, Button } = els
  const id = idOf(path)
  const isChanged = isDir ? m.dirty.has(id) || Boolean(m.git?.files[id]) : Boolean(m.git?.files[id])
  const items: { key: string; label: string; color?: string; run: (surface: RenderSurface) => void }[] = [
    { key: 'open', label: '열기', color: C.accent, run: () => acts.open(path) },
    { key: 'copy', label: '경로 복사', run: surface => acts.copy(path, surface) },
    isDir ? { key: 'map', label: '크기 그림', run: () => acts.map(path) } : { key: 'peek', label: '미리보기', run: () => acts.preview(path) },
  ]
  if (isChanged) items.push({ key: 'diff', label: '바뀐 내용', color: C.modified, run: () => acts.diff(path) })
  return (
    <Box key={`acts:${id}`} flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text dimColor>{rail}</Text>
      {items.map(item => (
        <Button key={`${item.key}:${id}`} plain onPress={e => item.run(e.surface)}>
          <Text color={item.color} bold>
            {item.label}
          </Text>
        </Button>
      ))}
    </Box>
  )
}

/** 평평한 목록 줄(검색 결과·변경 목록): 이름 + 흐린 폴더 + 오른쪽 표시. */
export function flatRow(els: Els, path: string, root: string, m: Marks, acts: Acts, opts: { isDir: boolean; extra?: string; onPress: () => void }) {
  const { Box, Text, Button } = els
  const id = idOf(path)
  const isSelected = m.selected !== null && idOf(m.selected) === id
  const name = baseName(path) + (opts.isDir ? '/' : '')
  const folder = relativeTo(root, parentOf(path))
  const extra = opts.extra ?? ''
  const room = Math.max(4, m.width - 1 - MARK_CELLS - cells(extra))
  const nameCells = Math.min(cells(name), room)
  const folderText = fit(folder ? `  ${folder}` : '', Math.max(0, room - nameCells))
  const mark = markOf({ path, isDir: opts.isDir }, m)
  const touch = m.fresh.get(id)
  return (
    <Box key={rowKey(path)} flexDirection="column">
      <Button key={`f:${id}`} plain onPress={() => opts.onPress()}>
        <Text color={isSelected ? C.accent : undefined}>{isSelected ? '›' : ' '}</Text>
        <Text color={isSelected ? C.accent : touch ? TOUCH_COLOR[touch.kind] : undefined} bold={isSelected}>
          {fit(name, nameCells)}
        </Text>
        <Text dimColor>{folderText}</Text>
        <Text dimColor>{extra}</Text>
        <Text> </Text>
        <Text color={mark.claudeColor}>{mark.claude}</Text>
        <Text color={mark.codeColor}>{mark.code}</Text>
      </Button>
      {isSelected ? actionBar(els, path, opts.isDir, m, acts, "  ") : null}
    </Box>
  )
}
