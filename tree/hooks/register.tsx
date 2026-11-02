// tree: 오른쪽 창에 프로젝트 파일 트리. 마우스로만 쓴다.
// 누르면 고르고, 고른 줄 아래 [열기]·[경로 복사](늘 절대 경로)·[미리보기]/[크기 그림]·[바뀐 내용].
// Claude 의 읽기(보라)·쓰기(주황)·커밋(초록)을 이름 색으로, git 상태를 오른쪽 글자로 보여 준다.
// 이벤트마다 훅은 하나씩만 달고 기능 함수를 부른다. 사람이 보지 않는 세션(claude -p)에선 아무것도 하지 않는다.
import type { EngineInterface, Register } from 'claude-code'

import { PANE, TOUCH_FRESH_MS, isShimmering, refreshGit, refreshListings } from './actions'
import { afterFileTool, afterShell, beforeShell, beforeWrite } from './activity'
import { readConfig } from './config'
import { setHidden } from './fsx'
import { norm } from './paths'
import { bumpTick, readGitOp, readTouches, writeRoot } from './state'
import { drawPane, makeActs } from './view/index'

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

const POLL_MS = 3_000
const TICK_MS = 1_000
/** 물결 반짝임 한 장면 간격(1초에 2번). 활동이 있는 8초 동안만 이 간격으로 다시 그린다. */
const SHIMMER_FRAME_MS = 500
const OP_TICK_MS = 30_000
const PANE_COLUMNS = 48

async function openPane($: EngineInterface, focus: boolean): Promise<boolean> {
  const base = { id: PANE, title: 'tree', columns: PANE_COLUMNS, ...(focus ? { focus: true as const } : {}) }
  try {
    const opened = await $.ui.open({ ...base, backgroundColor: 'transparent' })
    return opened.isPlaced
  } catch {
    // 바탕색 항목을 모르는 판: 없이 다시
    const opened = await $.ui.open(base).catch(() => ({ isPlaced: false }))
    return opened.isPlaced
  }
}

async function isPaneShown($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => [])
  return panes.some(p => p.id === PANE && p.isShown)
}

let pollCount = 0

/** 창이 보일 때만: 3초마다 펼친 폴더를, 6초마다 git 을 다시 읽는다(밖에서 바꾼 것도 보이게). */
async function poll($: EngineInterface): Promise<void> {
  if (!(await isPaneShown($))) return
  pollCount++
  await refreshListings($)
  if (pollCount % 2 === 0) await refreshGit($)
}

/** 진한 활동 표시나 git 진행 줄이 있을 때만 1초마다 다시 그린다. */
async function tick($: EngineInterface): Promise<void> {
  const now = Date.now()
  const touches = await readTouches($)
  const op = await readGitOp($)
  const isActive = Object.values(touches).some(t => now - t.at < TOUCH_FRESH_MS + TICK_MS) || (op !== null && (op.state === 'running' || now - op.at < OP_TICK_MS + TICK_MS))
  if (isActive) await bumpTick($)
}

function failed(result: { deny?: unknown; isError?: unknown }): boolean {
  return Boolean(result.deny) || result.isError === true
}

export const register: Register = (on, options) => {
  const config = readConfig(options)
  setHidden(config.hidden)
  let isHuman = false

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    isHuman = e.isInteractive
    if (!isHuman) return result
    await writeRoot($, norm(await $.session.root()))
    await $.command.register({ name: 'tree', description: '파일 트리 창을 열거나 닫습니다' }).catch(() => undefined)
    await refreshListings($).catch(() => undefined)
    void refreshGit($).catch(() => undefined)
    if (config.autoOpen) void openPane($, false).catch(() => undefined)
    $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    $.clock.every(SHIMMER_FRAME_MS, () => {
      if (isShimmering(Date.now())) void bumpTick($).catch(() => undefined)
    })
    return result
  })

  on('command.run', { command: 'tree' }, async $ => {
    if (await isPaneShown($)) {
      await $.ui.close({ id: PANE }).catch(() => undefined)
      return { text: '파일 트리를 닫았습니다.' }
    }
    await refreshListings($).catch(() => undefined)
    void refreshGit($).catch(() => undefined)
    const isPlaced = await openPane($, true)
    return { text: isPlaced ? '파일 트리를 열었습니다.' : '파일 트리를 열었습니다. 터미널이 좁으면 넓히면 옆에 붙습니다.' }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (!isHuman) return next(e)
    const call = { tool, input: e as unknown as Record<string, unknown> }
    if (WRITE_TOOLS.has(tool)) {
      const isNew = await beforeWrite($, call).catch(() => false)
      const result = await next(e)
      void afterFileTool($, call, { isFailed: failed(result), result: result.result }, isNew, config).catch(() => undefined)
      return result
    }
    if (READ_TOOLS.has(tool)) {
      const result = await next(e)
      void afterFileTool($, call, { isFailed: failed(result), result: result.result }, false, config).catch(() => undefined)
      return result
    }
    if (SHELL_TOOLS.has(tool)) {
      const start = await beforeShell($, call).catch(() => ({ verbs: [], heads: {}, startAt: Date.now() }))
      try {
        const result = await next(e)
        void afterShell($, start, { isFailed: failed(result), result: result.result }, config).catch(() => undefined)
        return result
      } catch (err) {
        void afterShell($, start, { isFailed: true, result: undefined }, config).catch(() => undefined)
        throw err
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    return drawPane($, els, Math.max(20, e.props.bodyColumns - 1), makeActs($))
  })
}
