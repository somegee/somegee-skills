// 폴더 읽기·검색·폴더 크기 재기·기본 프로그램으로 열기.
import type { EngineInterface } from 'claude-code'

import type { Entry, Tile } from '../types'
import { isWindowsPath, join, nativePath, norm } from './paths'

/** 숨길 이름 목록. register 가 /config 값으로 한 번 정한다. */
let hidden = new Set(['.git', 'node_modules'])

export function setHidden(names: readonly string[]): void {
  hidden = new Set(['.git', ...names])
}

export function isHidden(name: string): boolean {
  return hidden.has(name)
}

const DIR_LIMIT = 2000

/** 한 폴더를 읽어 폴더 먼저, 이름순으로. 못 읽으면 빈 목록. */
export async function listDir($: EngineInterface, dir: string): Promise<Entry[]> {
  try {
    const entries = await $.fs.list(dir)
    const out: Entry[] = []
    for (const one of entries.slice(0, DIR_LIMIT)) {
      if (hidden.has(one.name)) continue
      let isDir = one.kind === 'dir'
      if (one.isLink) {
        const target = await $.fs.stat(join(dir, one.name)).catch(() => null)
        isDir = target?.kind === 'dir'
      }
      out.push({ name: one.name, isDir, size: one.size })
    }
    return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  } catch {
    return []
  }
}

const INDEX_LIMIT = 30_000
const RESULT_LIMIT = 300

/** 검색용 전체 파일 목록(절대 경로). 세션 동안 한 번 만들고, 파일이 바뀌면 버린다. */
let index: { root: string; files: string[] } | null = null

export function dropIndex(): void {
  index = null
}

async function buildIndex($: EngineInterface, root: string): Promise<string[]> {
  const files: string[] = []
  const queue = [root]
  while (queue.length > 0 && files.length < INDEX_LIMIT) {
    const dir = queue.shift() as string
    for (const one of await listDir($, dir)) {
      const path = join(dir, one.name)
      if (one.isDir) queue.push(path)
      files.push(one.isDir ? `${path}/` : path)
    }
  }
  return files
}

function nameOf(entry: string): string {
  return (entry.replace(/\/$/, '').split('/').pop() ?? '').toLowerCase()
}

/** 이름에 글자가 들어간 파일·폴더(폴더는 끝에 '/'). 이름이 그 글자로 시작하는 것을 먼저. */
export async function searchFiles($: EngineInterface, root: string, text: string): Promise<string[]> {
  if (!index || index.root !== root) index = { root, files: await buildIndex($, root) }
  const needle = text.toLowerCase()
  const hits = index.files.filter(entry => nameOf(entry).includes(needle))
  const starts = hits.filter(entry => nameOf(entry).startsWith(needle))
  const rest = hits.filter(entry => !nameOf(entry).startsWith(needle))
  return [...starts, ...rest].slice(0, RESULT_LIMIT)
}

const SIZE_LIMIT = 40_000

/** 폴더 하나의 전체 크기. 너무 많으면 세다 멈추고 isPartial. */
async function folderSize($: EngineInterface, dir: string, budget: { left: number }): Promise<number> {
  let total = 0
  const queue = [dir]
  while (queue.length > 0 && budget.left > 0) {
    const cur = queue.shift() as string
    const entries = await $.fs.list(cur).catch(() => [])
    for (const one of entries) {
      budget.left--
      if (one.name === '.git' || one.isLink) continue
      if (one.kind === 'dir') queue.push(join(cur, one.name))
      else total += one.size
    }
  }
  return total
}

/** 폴더 바로 아래 항목들의 크기(하위 폴더는 통째로 합산). 큰 것부터. */
export async function measure($: EngineInterface, dir: string): Promise<{ tiles: Tile[]; isPartial: boolean }> {
  const budget = { left: SIZE_LIMIT }
  const entries = await $.fs.list(dir).catch(() => [])
  const tiles: Tile[] = []
  for (const one of entries) {
    if (one.name === '.git' || one.isLink) continue
    const path = join(dir, one.name)
    const isDir = one.kind === 'dir'
    const size = isDir ? await folderSize($, path, budget) : one.size
    tiles.push({ path, name: one.name, size, isDir })
  }
  return { tiles: tiles.filter(t => t.size > 0).sort((a, b) => b.size - a.size), isPartial: budget.left <= 0 }
}

// ── 열기 ──

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** powershell -EncodedCommand 가 받는 UTF-16LE base64. */
export function encodePowerShell(script: string): string {
  const bytes: number[] = []
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i)
    bytes.push(code & 0xff, code >> 8)
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64.charAt((n >> 18) & 63) + BASE64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? BASE64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? BASE64.charAt(n & 63) : '='
  }
  return out
}

// Start-Process 는 창을 보통 크기로 띄운다(Claude Code 가 자식 프로세스를 숨김으로 띄워도 새 창은 보인다).
// 경로는 환경 변수로 넘겨 따옴표·한글이 깨지지 않게 한다.
const OPEN_SCRIPT = 'Start-Process -FilePath $env:TREE_TARGET'

/** 파일은 연결된 프로그램으로, 폴더는 탐색기(Finder)로 연다. 실패하면 false. */
export async function openPath($: EngineInterface, path: string): Promise<boolean> {
  const full = norm(path)
  try {
    if (isWindowsPath(full)) {
      const argv = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(OPEN_SCRIPT)]
      const run = await $.process.run(argv, { env: { TREE_TARGET: nativePath(full) }, timeoutMs: 15_000 })
      return run.exitCode === 0
    }
    for (const argv of [['open', full], ['xdg-open', full]]) {
      const run = await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => null)
      if (run?.exitCode === 0) return true
    }
    return false
  } catch {
    return false
  }
}
