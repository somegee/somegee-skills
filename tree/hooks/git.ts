// git 상태 읽기, Claude 가 돌린 git 명령 알아보기, 바뀐 내용(diff) 가져오기.
import type { EngineInterface } from 'claude-code'

import type { DiffFile, GitInfo, RepoHead } from '../types'
import { idOf, isUnder, join, norm, relativeTo } from './paths'

const GIT_TIMEOUT_MS = 15_000

export async function runGit($: EngineInterface, cwd: string, args: readonly string[]) {
  return $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args], {
    timeoutMs: GIT_TIMEOUT_MS,
    env: { GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
  })
}

/** 폴더가 들어 있는 저장소의 맨 위 폴더. 저장소가 아니면 ''. */
export async function repoTop($: EngineInterface, dir: string): Promise<string> {
  try {
    const run = await runGit($, dir, ['rev-parse', '--show-toplevel'])
    return run.exitCode === 0 ? norm(run.stdout.trim()) : ''
  } catch {
    return ''
  }
}

type Branch = Pick<GitInfo, 'branch' | 'upstream' | 'ahead' | 'behind'>

/** '## main...origin/main [ahead 1, behind 2]' 한 줄을 읽는다. */
export function parseBranch(line: string): Branch {
  const body = line.replace(/^## /, '')
  const ahead = Number(/ahead (\d+)/.exec(body)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(body)?.[1] ?? 0)
  const names = body.replace(/ \[.*\]$/, '')
  if (names.startsWith('No commits yet on ')) return { branch: names.slice(18), upstream: '', ahead, behind }
  if (names.startsWith('HEAD (no branch)')) return { branch: 'HEAD', upstream: '', ahead, behind }
  const [branch = '', upstream = ''] = names.split('...')
  return { branch, upstream, ahead, behind }
}

/** XY 두 글자를 한 글자로: ? 새 파일, A 추가, D 지움, R 이름 바꿈, M 고침. */
export function codeOf(xy: string): string {
  if (xy === '??') return '?'
  if (xy.includes('U')) return 'U'
  if (xy.includes('D')) return 'D'
  if (xy.includes('R')) return 'R'
  if (xy.includes('A')) return 'A'
  return 'M'
}

/** `git status --porcelain=v1 -b -z` 출력을 읽는다. */
export function parseStatus(out: string, top: string): Branch & { files: Record<string, string>; paths: Record<string, string> } {
  const parts = out.split('\0')
  let branch: Branch = { branch: '', upstream: '', ahead: 0, behind: 0 }
  const files: Record<string, string> = {}
  const paths: Record<string, string> = {}
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    if (!part) continue
    if (part.startsWith('## ')) {
      branch = parseBranch(part)
      continue
    }
    const xy = part.slice(0, 2)
    const rel = part.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') i++ // 다음 칸은 옛 이름
    if (xy === '!!' || !rel) continue
    const abs = join(top, rel.replace(/\/$/, ''))
    files[idOf(abs)] = codeOf(xy)
    paths[idOf(abs)] = abs
  }
  return { ...branch, files, paths }
}

/** `git diff HEAD --numstat -z` 출력을 읽는다(바이너리는 '-'라 0으로). */
export function parseNumstat(out: string, top: string): Record<string, readonly [number, number]> {
  const lines: Record<string, readonly [number, number]> = {}
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i] ?? '')
    if (!m) continue
    let rel = m[3] ?? ''
    if (rel === '') {
      // 이름 바꿈: 다음 두 칸이 옛 이름, 새 이름
      rel = parts[i + 2] ?? ''
      i += 2
    }
    if (!rel) continue
    lines[idOf(join(top, rel))] = [m[1] === '-' ? 0 : Number(m[1]), m[2] === '-' ? 0 : Number(m[2])]
  }
  return lines
}

type RepoState = RepoHead & Pick<GitInfo, 'files' | 'lines' | 'paths'>

/** 저장소 하나의 상태. scope 폴더 아래만 본다(루트 저장소는 루트 아래, 안쪽 저장소는 전체). */
async function loadRepo($: EngineInterface, top: string, scope: string): Promise<RepoState | null> {
  const [status, numstat] = await Promise.all([
    runGit($, scope, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all', '--', '.']).catch(() => null),
    runGit($, scope, ['diff', 'HEAD', '--numstat', '-z', '--', '.']).catch(() => null),
  ])
  if (!status || status.exitCode !== 0) return null
  const parsed = parseStatus(status.stdout, top)
  const lines = numstat && numstat.exitCode === 0 ? parseNumstat(numstat.stdout, top) : {}
  return { top, ...parsed, lines }
}

const EMPTY_HEAD: RepoHead = { top: '', branch: '', upstream: '', ahead: 0, behind: 0 }

function headOfRepo(r: RepoState): RepoHead {
  return { top: r.top, branch: r.branch, upstream: r.upstream, ahead: r.ahead, behind: r.behind }
}

/**
 * 루트가 든 저장소 + 안쪽 저장소들(inner: 그 폴더 바로 아래에 .git 이 있는 폴더)의 상태를 합친다.
 * 바깥 저장소가 안쪽 저장소 폴더를 '새 폴더(?)' 하나로 보고하는 줄은 지운다(안쪽 파일들로 대신 보이므로).
 * 저장소가 하나도 없으면 null.
 */
export async function loadGit($: EngineInterface, root: string, inner: readonly string[] = []): Promise<GitInfo | null> {
  const rootTop = await repoTop($, root)
  const innerTops = inner.map(norm).filter(top => idOf(top) !== idOf(rootTop))
  const states = await Promise.all([
    rootTop ? loadRepo($, rootTop, root) : Promise.resolve(null),
    ...innerTops.map(top => loadRepo($, top, top)),
  ])
  const found = states.filter((s): s is RepoState => s !== null)
  if (found.length === 0) return null
  const innerIds = new Set(innerTops.map(idOf))
  const files: Record<string, string> = {}
  const lines: Record<string, readonly [number, number]> = {}
  const paths: Record<string, string> = {}
  const repos: Record<string, RepoHead> = {}
  for (const s of found) {
    repos[idOf(s.top)] = headOfRepo(s)
    for (const [id, code] of Object.entries(s.files)) {
      if (innerIds.has(id) && idOf(s.top) !== id) continue
      files[id] = code
      paths[id] = s.paths[id] ?? id
    }
    Object.assign(lines, s.lines)
  }
  const rootState = rootTop ? found.find(s => idOf(s.top) === idOf(rootTop)) : undefined
  return { ...(rootState ? headOfRepo(rootState) : EMPTY_HEAD), repos, files, lines, paths }
}

/** 경로가 든 저장소(가장 안쪽). 없으면 ''. */
export function repoFor(git: GitInfo, path: string): string {
  let best = ''
  for (const head of Object.values(git.repos)) {
    if (isUnder(head.top, path) && head.top.length > best.length) best = head.top
  }
  return best
}

/** 폴더(또는 파일)와 겹치는 저장소들: 그 안에 든 저장소 + 그것을 품은 저장소. */
export function reposTouching(git: GitInfo, path: string): string[] {
  const out = Object.values(git.repos)
    .map(h => h.top)
    .filter(top => isUnder(path, top))
  const outer = repoFor(git, path)
  return outer && !out.some(t => idOf(t) === idOf(outer)) ? [outer, ...out] : out
}

// ── Claude 가 돌린 셸 명령에서 git 동작 알아보기 ──

const VERBS: Record<string, string> = {
  commit: '커밋',
  push: '푸시',
  pull: '풀',
  fetch: '받아오기',
  merge: '병합',
  rebase: '리베이스',
  checkout: '브랜치 이동',
  switch: '브랜치 이동',
  stash: '스태시',
  reset: '되돌리기',
  restore: '되돌리기',
  revert: '되돌리기',
  'cherry-pick': '체리픽',
  tag: '태그',
  clone: '복제',
  init: '저장소 만들기',
}
const READ_ONLY = new Set(['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'grep', 'describe', 'config', 'remote', 'reflog', 'branch', 'help', 'version'])

/** 셸 명령에서 git·gh 가 바꾸는 동작의 이름을 고른다(읽기만 하는 것은 뺀다). */
export function gitVerbs(command: string): string[] {
  const out: string[] = []
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? '')) tokens.shift()
    const head = (tokens[0] ?? '').split(/[\\/]/).pop()?.replace(/\.exe$/i, '')
    if (head === 'git') {
      let i = 1
      while (i < tokens.length && (tokens[i] ?? '').startsWith('-')) i += tokens[i] === '-C' || tokens[i] === '-c' ? 2 : 1
      const verb = tokens[i] ?? ''
      if (READ_ONLY.has(verb)) continue
      if (verb === 'stash' && ['list', 'show'].includes(tokens[i + 1] ?? '')) continue
      const label = VERBS[verb]
      if (label) out.push(label)
    } else if (head === 'gh' && tokens[1] === 'pr' && ['create', 'merge'].includes(tokens[2] ?? '')) {
      out.push(tokens[2] === 'create' ? 'PR 열기' : 'PR 병합')
    }
  }
  return out
}

/** 마지막 커밋이 바꾼 파일들(커밋 표시용). */
export async function lastCommitFiles($: EngineInterface, top: string): Promise<string[]> {
  try {
    const run = await runGit($, top, ['show', '--name-only', '--pretty=format:', '-z', 'HEAD'])
    if (run.exitCode !== 0) return []
    return run.stdout
      .split('\0')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map(rel => join(top, rel))
  } catch {
    return []
  }
}

export async function headOf($: EngineInterface, top: string): Promise<string> {
  try {
    const run = await runGit($, top, ['rev-parse', 'HEAD'])
    return run.exitCode === 0 ? run.stdout.trim() : ''
  } catch {
    return ''
  }
}

// ── 바뀐 내용(diff) ──

/** `git diff` 출력을 파일별로 나눠 '@@' 부터의 내용만 남긴다. */
export function splitDiff(patch: string): DiffFile[] {
  return patch
    .replace(/\r\n?/g, '\n')
    .split(/^(?=diff --git )/m)
    .map(part => {
      const plus = /^\+\+\+ (?:b\/)?(.+)$/m.exec(part)?.[1]
      const head = /^diff --git a\/.+? b\/(.+)$/m.exec(part)?.[1]
      const title = (plus && plus !== '/dev/null' ? plus : head) ?? ''
      const at = part.search(/^@@ /m)
      const source = at >= 0 ? part.slice(at).replace(/\n$/, '') : ''
      let add = 0
      let del = 0
      for (const line of source.split('\n')) {
        if (line.startsWith('+')) add++
        else if (line.startsWith('-')) del++
      }
      const note = /^Binary files /m.test(part) ? '(바이너리 파일이 바뀜)' : /^rename from /m.test(part) ? '(이름만 바뀜)' : ''
      return { title, source: source || note, add, del }
    })
    .filter(f => f.title && f.source)
}

/** 새 파일(git 이 아직 모르는 파일)의 내용을 '전부 추가'한 diff 로 만든다. */
export function addedDiff(title: string, text: string): DiffFile {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  return { title, source: [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n'), add: lines.length, del: 0 }
}

/** 파일·폴더의 바뀐 내용. 저장소가 아니면 null. */
export async function diffOf($: EngineInterface, top: string, path: string): Promise<DiffFile[] | null> {
  const rel = relativeTo(top, path) || '.'
  const run = await runGit($, top, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-M', '--', rel]).catch(() => null)
  if (!run) return null
  if (run.exitCode !== 0) {
    // 커밋이 하나도 없는 저장소: 올려 둔 것과 비교
    const staged = await runGit($, top, ['diff', '--cached', '--no-color', '--', rel]).catch(() => null)
    return staged && staged.exitCode === 0 ? splitDiff(staged.stdout) : null
  }
  return splitDiff(run.stdout)
}
