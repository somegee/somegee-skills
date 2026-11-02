// Claude 의 도구 호출을 보고 트리에 읽기·쓰기·커밋을 표시한다.
import type { EngineInterface } from 'claude-code'

import { innerRepos, refreshGit, refreshListings, remember, rootOf, touch } from './actions'
import type { Config } from './config'
import { gitVerbs, headOf, lastCommitFiles, repoTop } from './git'
import { resolvePath } from './paths'
import { writeGitOp } from './state'

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

export type ShellStart = { verbs: string[]; heads: Record<string, string> }

/** 셸 명령 전에: git 동작이면 '○○ 중…' 을 띄우고, 커밋이면 아는 저장소마다 지금 HEAD 를 기억한다. */
export async function beforeShell($: EngineInterface, call: Call): Promise<ShellStart | null> {
  const verbs = gitVerbs(textField(call.input, 'command'))
  if (verbs.length === 0) return null
  await writeGitOp($, { label: `${verbs.join('·')} 중…`, state: 'running', at: Date.now() })
  return { verbs, heads: verbs.includes('커밋') ? await repoHeads($) : {} }
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

export async function afterShell($: EngineInterface, start: ShellStart | null, outcome: Outcome): Promise<void> {
  scheduleRefresh($)
  if (!start) return
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
