// 창 하나를 그린다: 머리줄 → 탭 → 검색칸 → (미리보기 | 트리·검색 결과 | 변경 목록 | 크기 그림) → git 진행 줄.
import type { EngineInterface, ElementTable } from 'claude-code'

import type { Touch } from '../../types'
import {
  TOUCH_FRESH_MS,
  clearSearch,
  closePreview,
  copyPath,
  forgetRecent,
  jumpTo,
  openItem,
  pressRow,
  refreshGit,
  refreshListings,
  rootOf,
  runSearch,
  setMode,
  showDiff,
  showMap,
  showPreview,
} from '../actions'
import { dropIndex } from '../fsx'
import { idOf, isUnder } from '../paths'
import {
  readGit,
  readGitOp,
  readListings,
  readMap,
  readMode,
  readOpened,
  readPreview,
  readQuery,
  readRecent,
  readResults,
  readSelected,
  readTick,
  readTouches,
  writeMode,
} from '../state'
import type { Acts, Els } from './look'
import { gitOpLine, header, mapPanel, previewPanel, recentPanel, rule, searchBox, tabs } from './panels'
import { buildRows, dirtyDirs, flatRow, treeRow } from './rows'
import type { Marks } from './rows'

export function makeActs($: EngineInterface): Acts {
  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined)
  return {
    press: (path, isDir) => quiet(pressRow($, path, isDir)),
    jump: path => quiet(jumpTo($, path)),
    open: path => quiet(openItem($, path)),
    copy: (path, surface) => quiet(copyPath($, path, surface)),
    preview: path => quiet(showPreview($, path)),
    diff: path => quiet(showDiff($, path)),
    map: dir => quiet(writeMode($, 'map').then(() => showMap($, dir))),
    closePreview: () => quiet(closePreview($)),
    mode: mode => quiet(setMode($, mode)),
    search: text => quiet(runSearch($, text)),
    clearSearch: () => quiet(clearSearch($)),
    forget: () => quiet(forgetRecent($)),
    refresh: () => {
      dropIndex()
      quiet(refreshListings($))
      quiet(refreshGit($))
    },
  }
}

const MAX_TREE_ROWS = 3000
const CHANGES_LIMIT = 500

export async function drawPane($: EngineInterface, els: ElementTable<'terminal'>, width: number, acts: Acts) {
  const { Box, Text } = els
  const root = await rootOf($)
  const [mode, opened, listings, selected, query, results, git, touches, gitOp, recent, preview, map] = await Promise.all([
    readMode($),
    readOpened($),
    readListings($),
    readSelected($),
    readQuery($),
    readResults($),
    readGit($),
    readTouches($),
    readGitOp($),
    readRecent($),
    readPreview($),
    readMap($),
  ])
  await readTick($) // 1초마다 다시 그려 활동 표시를 흐리게 한다
  const now = Date.now()
  const fresh = new Map<string, Touch>()
  for (const [id, t] of Object.entries(touches)) if (now - t.at < TOUCH_FRESH_MS) fresh.set(id, t)
  const changedIds = git ? Object.keys(git.files).filter(id => isUnder(root, id)) : []
  const marks: Marks = {
    git,
    dirty: dirtyDirs(root, git),
    recent: new Map(recent.map(r => [idOf(r.path), r.kind === 'new' ? ('+' as const) : ('~' as const)])),
    fresh,
    selected,
    width,
  }
  const e: Els = els
  let body
  if (preview) {
    body = previewPanel(e, preview, root, width, acts)
  } else if (mode === 'map') {
    body = mapPanel(e, map, root, width, acts)
  } else if (mode === 'changes') {
    const paths = changedIds.map(id => git?.paths[id] ?? id).sort((a, b) => a.localeCompare(b)).slice(0, CHANGES_LIMIT)
    body = (
      <Box key="changes" flexDirection="column">
        {paths.length === 0 ? <Text dimColor>{git ? '바뀐 파일이 없습니다.' : 'git 저장소가 아닙니다.'}</Text> : null}
        {paths.map(path => {
          const lines = git?.lines[idOf(path)]
          const extra = lines ? ` +${lines[0]} -${lines[1]}` : ''
          return flatRow(e, path, root, marks, acts, { isDir: false, extra, onPress: () => acts.press(path, false) })
        })}
      </Box>
    )
  } else if (results !== null) {
    body = (
      <Box key="results" flexDirection="column">
        {results.length === 0 ? <Text dimColor>찾은 파일이 없습니다.</Text> : null}
        {results.map(entry => {
          const path = entry.replace(/\/$/, '')
          return flatRow(e, path, root, marks, acts, { isDir: entry.endsWith('/'), onPress: () => acts.jump(path) })
        })}
      </Box>
    )
  } else {
    const rows = buildRows(root, listings, new Set(opened.map(idOf))).slice(0, MAX_TREE_ROWS)
    body = (
      <Box key="rows" flexDirection="column">
        {rows.length === 0 ? <Text dimColor>빈 폴더입니다.</Text> : null}
        {rows.map(row => treeRow(e, row, marks, acts))}
        {recentPanel(e, recent, root, width, acts)}
      </Box>
    )
  }
  const gitLine = gitOpLine(e, gitOp, now)
  return (
    <Box flexDirection="column">
      {header(e, root, git)}
      {tabs(e, mode, changedIds.length, acts)}
      {mode === 'tree' && !preview ? searchBox(e, query, results ? results.length : null, acts) : null}
      {rule(e, width)}
      {body}
      {gitLine ? rule(e, width) : null}
      {gitLine}
    </Box>
  )
}
