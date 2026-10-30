// 사용 한도 경고와 절약 모드(한도가 풀릴 때까지 자동 effort 를 '중간' 이하로).
import type { EngineInterface } from 'claude-code'

import type { LimitRow } from '../types'
import { readSaveUntil, readStatus, writeSaveUntil } from './state'

export const LIMIT_WARN = 80
const SAVE_FALLBACK_MS = 5 * 60 * 60_000
const STORE_KEY = 'saveUntil'

/** 80% 를 넘은 한도 중 가장 높은 것. 없으면 null. */
export function hottest(limits: readonly LimitRow[]): LimitRow | null {
  const over = limits.filter(l => l.percent >= LIMIT_WARN)
  return over.length ? over.reduce((a, b) => (b.percent > a.percent ? b : a)) : null
}

/** 한도가 풀리는 시각(ms). 모르면 지금부터 5시간. */
export function resetTime(limit: LimitRow | null, now: number): number {
  const at = limit?.resetsAt ? Date.parse(limit.resetsAt) : NaN
  return Number.isFinite(at) && at > now ? at : now + SAVE_FALLBACK_MS
}

/** '19:40' 처럼 시:분. */
export function clockText(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 지금 절약 중인가. 풀릴 시각이 지났으면 스스로 끈다. */
export async function isSavingNow($: EngineInterface): Promise<boolean> {
  const until = await readSaveUntil($)
  if (until === null) return false
  const now = await $.clock.now().catch(() => Date.now())
  if (now < until) return true
  await writeSaveUntil($, null)
  await $.store.set(STORE_KEY, null).catch(() => undefined)
  return false
}

/** 세션 시작 때 이전 세션이 켜 둔 절약 모드를 이어받는다(아직 안 풀렸으면). */
export async function restoreSave($: EngineInterface): Promise<void> {
  const kept = await $.store.get(STORE_KEY).catch(() => null)
  if (typeof kept !== 'number') return
  await writeSaveUntil($, kept)
  await isSavingNow($)
}

/** 절약 켜기/끄기. 한 일을 한국어로 돌려준다. */
export async function toggleSave($: EngineInterface): Promise<string> {
  if (await isSavingNow($)) {
    await writeSaveUntil($, null)
    await $.store.set(STORE_KEY, null).catch(() => undefined)
    return '절약 모드를 껐어요.'
  }
  const now = await $.clock.now().catch(() => Date.now())
  const limits = (await readStatus($))?.limits ?? []
  const until = resetTime(hottest(limits) ?? limits[0] ?? null, now)
  await writeSaveUntil($, until)
  await $.store.set(STORE_KEY, until).catch(() => undefined)
  return `절약 모드를 켰어요. ${clockText(until)}까지 자동 effort 를 medium 이하로 묶습니다.`
}
