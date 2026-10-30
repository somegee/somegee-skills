// 상태줄 값 새로 고침과 캐시 시계. 요청이 끝날 때마다, 그리고 30초마다(한도·남은 분).
import type { EngineInterface, TurnStepResult } from 'claude-code'

import { isSavingNow } from '../limits'
import { writeCacheUntil, writeStatus } from '../state'
import type { Ctx } from '../state'
import { CACHE_TTL, cacheTtlOf, touchedCache } from './cache'
import type { CacheTtl } from './cache'
import { collectStatus } from './statusline'

export const TICK_MS = 30_000

let refreshing = false
// 마지막으로 본 캐시 보관 시간. 캐시를 읽기만 한 요청은 이 값으로 다시 잰다(1시간짜리를 5분으로 잘못 보지 않게).
let ttl: CacheTtl | undefined

export async function refreshStatus($: EngineInterface, ctx: Ctx): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const next = await collectStatus($, ctx.modelId)
    await writeStatus($, next)
  } finally {
    refreshing = false
  }
}

/** 메인 요청 하나가 끝났을 때: 캐시 시계를 다시 맞추고 상태줄을 새로 고친다. */
export async function afterStep($: EngineInterface, ctx: Ctx, result: TurnStepResult): Promise<void> {
  if (result.usage && touchedCache(result.usage)) {
    ttl = cacheTtlOf(result.usage) ?? ttl ?? '5m'
    const now = await $.clock.now().catch(() => Date.now())
    await writeCacheUntil($, now + CACHE_TTL[ttl ?? '5m'])
  }
  void refreshStatus($, ctx).catch(() => undefined)
}

/** 30초마다: 한도 다시 읽기, 절약 모드 만료, 남은 분 다시 그리기. */
export async function tick($: EngineInterface, ctx: Ctx): Promise<void> {
  await isSavingNow($)
  await refreshStatus($, ctx)
  $.ui.invalidate('ui.render')
}
