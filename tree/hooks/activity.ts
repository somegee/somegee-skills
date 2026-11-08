// Claude 의 도구 호출을 보고 트리에 읽기·쓰기·커밋을 표시한다.
import type { EngineInterface } from 'claude-code'

import { innerRepos, refreshGit, refreshListings, remember, rootOf, touch } from './actions'
import type { Config } from './config'
import { gitVerbs, headOf, lastCommitFiles, repoTop } from './git'
import { isHidden } from './fsx'
import { idOf, isUnder, join, relativeTo, resolvePath } from './paths'
import { outputPaths, shellReadPaths, type Shell } from './shellreads'
import { readGit, readOpened, writeGitOp } from './state'

type Call = { tool: string; input: Record<string, unknown> }
type Outcome = { isFailed: boolean; result: unknown }

function textField(input: Record<string, unknown>, key: string): string {
  const v = input[key]
  return typeof v === 'string' ? v : ''
}

function filenamesOf(result: unknown): string[] {
  if (!result || typeof result !== 'object' || !('filenames' in result)) return []
  const names = (result as { filenames: unknown }).filenames
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string').slice(0, 60) : []
}

/** 파일 쓰기 전에: 새 파일인지 기억해 둔다. */
export async function beforeWrite($: EngineInterface, call: Call): Promise<boolean> {
  const file = textField(call.input, 'file_path') || textField(call.input, 'notebook_path')
  if (!file) return false
  return !(await $.fs.exists(file).catch(() => true))
}

let refreshTimer: { cancel(): void } | null = null

/** 파일이 바뀌었을 수 있을 때: 목록·git 을 잠깐 모았다가 한 번에 다시 읽는다. */
export function scheduleRefresh($: EngineInterface): void {
  refreshTimer?.cancel()
  refreshTimer = $.clock.after(400, () => {
    void refreshListings($).catch(() => undefined)
    void refreshGit($).catch(() => undefined)
  })
}

export async function afterFileTool($: EngineInterface, call: Call, outcome: Outcome, isNew: boolean, config: Config): Promise<void> {
  if (outcome.isFailed) return
  const cwd = await $.session.cwd()
  if (call.tool === 'Read') {
    if (!config.showReads) return
    const file = textField(call.input, 'file_path')
    if (file) await touch($, [resolvePath(cwd, file)], 'read', config.follow === 'all')
    return
  }
  if (call.tool === 'Grep' || call.tool === 'Glob') {
    if (!config.showReads) return
    await touch($, filenamesOf(outcome.result).map(name => resolvePath(cwd, name)), 'read', false)
    return
  }
  const file = textField(call.input, 'file_path') || textField(call.input, 'notebook_path')
  if (!file) return
  const full = resolvePath(cwd, file)
  await touch($, [full], 'write', config.follow !== 'off')
  await remember($, full, isNew, config)
  scheduleRefresh($)
}

/** command·cwd 는 읽은 파일을 찾을 때 쓴다(cwd 는 명령이 시작한 폴더). */
export type ShellStart = { verbs: string[]; heads: Record<string, string>; startAt: number; command?: string; cwd?: string; shell?: Shell }

/** 셸 명령 전에: 시작 시각을 기억하고, git 동작이면 '○○ 중…' 을 띄우고, 커밋이면 저장소마다 HEAD 를 기억한다. */
export async function beforeShell($: EngineInterface, call: Call): Promise<ShellStart> {
  const startAt = Date.now()
  const command = textField(call.input, 'command')
  const cwd = await $.session.cwd().catch(() => '')
  const base = { startAt, command, cwd, shell: call.tool === 'PowerShell' ? ('powershell' as const) : ('bash' as const) }
  const verbs = gitVerbs(command)
  if (verbs.length === 0) return { ...base, verbs, heads: {} }
  await writeGitOp($, { label: `${verbs.join('·')} 중…`, state: 'running', at: Date.now() })
  return { ...base, verbs, heads: verbs.includes('커밋') ? await repoHeads($) : {} }
}

/** 루트 저장소 + 트리에 보이는 안쪽 저장소의 HEAD. */
async function repoHeads($: EngineInterface): Promise<Record<string, string>> {
  const tops = new Set<string>()
  const rootTop = await repoTop($, await rootOf($))
  if (rootTop) tops.add(rootTop)
  for (const top of await innerRepos($)) tops.add(top)
  const heads: Record<string, string> = {}
  for (const top of tops) heads[top] = await headOf($, top)
  return heads
}

const SHELL_TOUCH_LIMIT = 30
const STAT_LIMIT = 400
/** 파일 시각이 명령 시작보다 조금 이르게 찍히는 경우(파일 시스템 시각 단위)를 봐준다. */
const MTIME_SLACK_MS = 1_500

/**
 * 셸 명령이 바꾼 파일 찾기: 트리에 보이는 폴더(루트·펼친 폴더)의 파일과 git 이 바뀌었다고 보는 파일 중
 * 수정 시각이 명령 시작 뒤인 것. (cp·sed -i·리다이렉트처럼 Write/Edit 를 안 거친 쓰기)
 */
async function changedSince($: EngineInterface, startAt: number): Promise<string[]> {
  const since = startAt - MTIME_SLACK_MS
  const root = await rootOf($)
  const dirs = [root, ...(await readOpened($)).filter(dir => isUnder(root, dir))]
  const hits = new Map<string, string>()
  for (const dir of dirs) {
    const entries = await $.fs.list(dir).catch(() => [])
    for (const one of entries) {
      if (one.kind === 'file' && one.mtimeMs >= since && !isHidden(one.name)) hits.set(idOf(join(dir, one.name)), join(dir, one.name))
    }
  }
  const git = await readGit($)
  const changed = git ? Object.entries(git.paths).filter(([id]) => !hits.has(id) && isUnder(root, id)) : []
  for (const [id, abs] of changed.slice(0, STAT_LIMIT)) {
    const stat = await $.fs.stat(abs).catch(() => null)
    if (stat && stat.kind === 'file' && stat.mtimeMs >= since) hits.set(id, abs)
  }
  return [...hits.values()].slice(0, SHELL_TOUCH_LIMIT)
}

const SHELL_READ_LIMIT = 30

function stdoutOf(result: unknown): string {
  if (!result || typeof result !== 'object' || !('stdout' in result)) return ''
  const out = (result as { stdout: unknown }).stdout
  return typeof out === 'string' ? out : ''
}

/** 루트 아래의 숨김 이름(.git·node_modules 따위)을 지나는 경로인가. */
function isHiddenPath(root: string, path: string): boolean {
  return relativeTo(root, path).split('/').some(isHidden)
}

/**
 * 셸 명령이 읽은 파일(cat·sed -n·grep·rg … 의 파일 인자, grep -r·rg·find 출력의 경로)을 보라로 칠한다.
 * 루트 아래에 실제로 있는 파일만, 숨김 이름은 빼고, 같은 명령이 쓴 파일은 빼고(쓰기가 이긴다).
 */
async function markShellReads($: EngineInterface, start: ShellStart, result: unknown, written: readonly string[], config: Config): Promise<void> {
  if (!start.command || !start.cwd) return
  const fromArgs = shellReadPaths(start.command, start.cwd, start.shell)
  const fromOutput = start.shell === 'powershell' ? [] : outputPaths(start.command, stdoutOf(result), start.cwd)
  const root = await rootOf($)
  const skip = new Set(written.map(idOf))
  const files: string[] = []
  for (const path of [...fromArgs, ...fromOutput]) {
    if (files.length >= SHELL_READ_LIMIT) break
    const id = idOf(path)
    if (skip.has(id) || !isUnder(root, path) || isHiddenPath(root, path)) continue
    skip.add(id)
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat?.kind === 'file') files.push(path)
  }
  await touch($, files, 'read', config.follow === 'all')
}

export async function afterShell($: EngineInterface, start: ShellStart, outcome: Outcome, config: Config): Promise<void> {
  // 셸이 쓴 파일: git 을 먼저 다시 읽어 새 파일도 후보에 넣는다
  await refreshGit($).catch(() => undefined)
  const written = await changedSince($, start.startAt).catch(() => [])
  if (written.length > 0) {
    await touch($, written, 'write', config.follow !== 'off')
    const git = await readGit($)
    for (const path of written) await remember($, path, git?.files[idOf(path)] === '?', config)
  }
  if (config.showReads && !outcome.isFailed) await markShellReads($, start, outcome.result, written, config).catch(() => undefined)
  scheduleRefresh($)
  if (start.verbs.length === 0) return
  const label = start.verbs.join('·')
  if (outcome.isFailed) {
    await writeGitOp($, { label: `${label} 실패`, state: 'failed', at: Date.now() })
    return
  }
  await writeGitOp($, { label: `${label} 끝`, state: 'done', at: Date.now() })
  // HEAD 가 바뀐 저장소의 마지막 커밋 파일들을 초록으로
  for (const [top, before] of Object.entries(start.heads)) {
    if (before && (await headOf($, top)) !== before) await touch($, await lastCommitFiles($, top), 'commit', false)
  }
}
