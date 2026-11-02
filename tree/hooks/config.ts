// /config(userConfig) 값을 읽어 기본값·범위로 맞춘다.

export type Follow = 'writes' | 'all' | 'off'

export type Config = {
  autoOpen: boolean
  follow: Follow
  hidden: readonly string[]
  recentLimit: number
  showReads: boolean
}

const DEFAULT_HIDDEN = 'node_modules __pycache__ .venv .pytest_cache .mypy_cache .DS_Store'

export function readConfig(options: Readonly<Record<string, unknown>> | undefined): Config {
  const o = options ?? {}
  const follow = o.follow === 'all' || o.follow === 'writes' ? o.follow : 'off'
  const hiddenText = typeof o.hidden === 'string' ? o.hidden : DEFAULT_HIDDEN
  const limit = Number(o.recentLimit ?? 8)
  return {
    autoOpen: o.autoOpen !== false,
    follow,
    hidden: hiddenText.split(/[\s,]+/).filter(Boolean),
    recentLimit: Number.isFinite(limit) ? Math.max(1, Math.min(30, Math.round(limit))) : 8,
    showReads: o.showReads !== false,
  }
}
