// 상태줄 1줄 데이터: statusline.py 가 보여 주던 폴더·브랜치·모델·컨텍스트·버전 + 사용 한도.
import type { EngineInterface, SessionRateLimit } from 'claude-code'

import type { LimitRow, StatusData } from '../../types'

const BRANCH_TTL_MS = 15_000
const GIT_TIMEOUT_MS = 1000

/** 'claude-opus-5-5[1m]' → 'Opus 5.5'. 모르는 이름은 그대로. */
export function modelLabel(id: string): string {
  const [, family, major, minor] = id.match(/(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i) ?? []
  if (!family || !major || !minor) return id.replace(/\[.*\]$/, '')
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}.${minor}`
}

/** 한도 종류 이름 → 짧은 한국어. */
export function limitLabel(kind: string): string {
  const k = kind.toLowerCase()
  const model = /opus/.test(k) ? '(Opus)' : /sonnet/.test(k) ? '(Sonnet)' : ''
  if (/five|5h|5_hour|session/.test(k)) return `5시간${model}`
  if (/seven|7d|7_day|week/.test(k)) return `주간${model}`
  return kind
}

export function limitRows(limits: readonly SessionRateLimit[]): LimitRow[] {
  return limits
    .filter(l => Number.isFinite(l.percentUsed))
    .map(l => ({ label: limitLabel(l.kind), percent: Math.round(l.percentUsed), ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) }))
}

/** 경로 끝 폴더 이름(윈도우 \ 도). */
export function folderOf(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

let branchCache: { cwd: string; at: number; branch: string } | null = null

/** git 브랜치. 15초 동안은 다시 묻지 않는다. git 이 없거나 저장소가 아니면 ''. */
export async function gitBranch($: EngineInterface, cwd: string, now: number): Promise<string> {
  if (branchCache && branchCache.cwd === cwd && now - branchCache.at < BRANCH_TTL_MS) return branchCache.branch
  const r = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: GIT_TIMEOUT_MS }).catch(() => null)
  const branch = r && r.exitCode === 0 ? r.stdout.trim() : ''
  branchCache = { cwd, at: now, branch }
  return branch
}

/** 지금 상태를 한 번에 모은다. 하나가 실패해도 나머지는 그린다. */
export async function collectStatus($: EngineInterface, modelId: string): Promise<StatusData> {
  const [cwd, sessionModel, usage, version, now] = await Promise.all([
    $.session.cwd().catch(() => ''),
    modelId ? Promise.resolve(modelId) : $.session.model().catch(() => ''),
    $.session.usage().catch(() => null),
    $.session.version().catch(() => null),
    $.clock.now().catch(() => Date.now()),
  ])
  const branch = cwd ? await gitBranch($, cwd, now) : ''
  const ctx = usage?.context
  const window = ctx?.window ?? 0
  const tokens = ctx?.tokens ?? 0
  const percent = ctx?.percent ?? (window > 0 ? (tokens / window) * 100 : 0)
  return {
    folder: folderOf(cwd),
    branch,
    model: modelLabel(sessionModel),
    modelId: sessionModel,
    version: version?.version ?? '',
    contextTokens: tokens,
    contextWindow: window,
    contextPercent: Math.round(percent),
    limits: limitRows(usage?.rateLimits ?? []),
  }
}

/** 74000 → '74k'. */
export function kilo(n: number): string {
  return n >= 1000 ? `${Math.floor(n / 1000)}k` : String(n)
}
