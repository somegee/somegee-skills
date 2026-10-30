// effort 단계 계산: 범위 안으로 넣기, 절약 모드, 모델별로 바꿔도 되는지, 짧은 답·직접 지정 알아보기.
// 일부 규칙은 effortless(HeyCubit, MIT)의 측정 결과를 따른다. NOTICE 참고.
import type { Effort } from '../../types'

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const rank = (e: Effort) => EFFORTS.indexOf(e)

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

/** floor~ceiling 사이로 넣는다. */
export function clamp(effort: Effort, floor: Effort, ceiling: Effort): Effort {
  const i = Math.min(Math.max(rank(effort), rank(floor)), rank(ceiling))
  return EFFORTS[i] ?? effort
}

/** 둘 중 높은 쪽. */
export function atLeast(effort: Effort, min: Effort): Effort {
  return rank(effort) >= rank(min) ? effort : min
}

/** 절약 모드면 중간을 넘지 않게. */
export function capForSave(effort: Effort, isSaving: boolean): Effort {
  return isSaving && rank(effort) > rank('medium') ? 'medium' : effort
}

/** 하위 에이전트의 바닥: 범위 바닥과 '중간' 중 높은 쪽, 천장은 넘지 않음. 하위 에이전트 답은 검토 없이 돌아오므로. */
export function helperFloor(floor: Effort, ceiling: Effort): Effort {
  return clamp(atLeast(floor, 'medium'), floor, ceiling)
}

// 요청마다 effort 를 바꿔도 프롬프트 캐시가 유지되는 모델. Fable 5.1·옛 Opus 는 바꾸면 캐시를 56~100% 다시 썼다(effortless 실측).
export const cacheSafe = (modelId: string) => /(opus|sonnet)-5-5/.test(modelId)
export const isHaiku = (modelId: string) => /haiku/.test(modelId)

/** "ㄱㄱ", "응", "ok", "계속" 같은 짧은 후속 답: 12자·두 단어 이하. */
export function isFollowUp(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && t.length <= 12 && t.split(/\s+/).length <= 2
}

/** 직전 답이 질문으로 끝났나(그럼 짧은 답도 새 일을 시작할 수 있어 판정한다). */
export function endsOnQuestion(lastAnswer: string): boolean {
  return /[?？]/.test(lastAnswer.slice(-400))
}

const KO_LEVEL: Readonly<Record<string, Effort>> = {
  낮음: 'low', 낮게: 'low', 중간: 'medium', 높음: 'high', 높게: 'high', '아주 높음': 'xhigh', '아주 높게': 'xhigh', 아주높음: 'xhigh', 최대: 'max', 최대로: 'max',
}
const KO_NAMED = /(?:effort|에포트|추론\s*강도)\s*(?:를|을|는|은|:|=)?\s*(낮음|낮게|중간|높음|높게|아주\s?높음|아주\s?높게|최대로|최대)/i
const EN_NAMED = /\b(low|medium|high|xhigh|max)\s+effort\b|\beffort(?:\s+level)?\s*(?:[:=]|to|at|on)?\s*(low|medium|high|xhigh|max)\b/i
const EN_NEGATION = /\b(not|no|don'?t|never|without)\b/i

/** 질문에 effort 를 직접 적었으면 그 값("effort 높음으로", "max effort"). 부정문("don't use max effort")은 제외. */
export function namedEffort(text: string): Effort | undefined {
  const word = text.match(KO_NAMED)?.[1]
  if (word) return KO_LEVEL[word.replace(/\s+/g, ' ')] ?? KO_LEVEL[word.replace(/\s+/g, '')]
  const en = text.match(EN_NAMED)
  if (!en || en.index === undefined) return undefined
  if (EN_NEGATION.test(text.slice(Math.max(0, en.index - 20), en.index))) return undefined
  const level = (en[1] ?? en[2] ?? '').toLowerCase()
  return isEffort(level) ? level : undefined
}
