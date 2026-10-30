// 프롬프트 캐시가 언제 식는지. 요청 결과의 usage 로 마지막 캐시 기록 시각과 보관 시간(1시간/5분)을 안다.
// 판별 방식은 effortless(HeyCubit, MIT)의 cacheTtlOf 를 따른다.

export const CACHE_TTL = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const
export type CacheTtl = keyof typeof CACHE_TTL

type Usage = { cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } } | null | undefined

/** 이번 요청이 캐시를 몇 분짜리로 썼나. 캐시를 읽기만 했으면 undefined(이전 값을 그대로 쓴다). */
export function cacheTtlOf(usage: unknown): CacheTtl | undefined {
  const c = (usage as Usage)?.cache_creation
  if ((c?.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
  if ((c?.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  return undefined
}

/** 캐시를 건드린 요청이었나(읽었거나 썼거나). */
export function touchedCache(usage: unknown): boolean {
  const u = (usage ?? {}) as { cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  return (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) > 0
}

/** 남은 분(올림). 기록이 없으면 null, 지났으면 0. */
export function minutesLeft(until: number | null, now: number): number | null {
  if (until === null) return null
  return Math.max(0, Math.ceil((until - now) / 60_000))
}
