// 모델 한 번 묻기(대화 기록 없이). 쓰는 사람의 Claude 로그인으로 돌고 키가 필요 없다.
// 판정·인계 추천은 늘 Haiku, 압축·인계 메모는 설정에서 고른 모델.
import type { EngineInterface, ModelCompleteResult, ModelEffort } from 'claude-code'

export type ModelKey = 'haiku' | 'sonnet' | 'opus'

// 이름으로 부른다: 옛 빌드는 별칭('haiku')을 옛 모델(Haiku 4.5, 10배 비쌈)로 잇는다. 이름을 모를 때만 별칭으로.
export const MODELS: Readonly<Record<ModelKey, { id: string; alias: string; label: string }>> = {
  haiku: { id: 'claude-haiku-5-5', alias: 'haiku', label: 'Haiku 5.5' },
  sonnet: { id: 'claude-sonnet-5-5', alias: 'sonnet', label: 'Sonnet 5.5' },
  opus: { id: 'claude-opus-5-5', alias: 'opus', label: 'Opus 5.5' },
}
export const HAIKU = MODELS.haiku.id

export type Asked = { text: string } | { fail: string }

export type AskArgs = {
  system: string
  prompt: string
  maxTokens: number
  timeoutMs: number
  effort?: ModelEffort
}

function why(r: ModelCompleteResult): string {
  if (r.isAnswered) return ''
  if (r.reason === 'api-error') return `api-error ${r.status ?? ''}`.trim()
  return r.reason
}

export async function askModel($: EngineInterface, key: ModelKey, args: AskArgs): Promise<Asked> {
  const ask = (model: string) =>
    $.model.complete({
      model,
      system: args.system,
      prompt: args.prompt,
      maxTokens: args.maxTokens,
      effort: args.effort ?? 'low',
      timeoutMs: args.timeoutMs,
    })
  let r = await ask(MODELS[key].id)
  // 모델 이름을 모르는 옛 빌드(400/404)일 때만 별칭으로 다시: 한도·시간 초과에 두 번 부르지 않게.
  if (!r.isAnswered && r.reason === 'api-error' && (r.status === 400 || r.status === 404)) r = await ask(MODELS[key].alias)
  if (!r.isAnswered) return { fail: why(r) }
  return r.text.trim() ? { text: r.text } : { fail: 'empty-reply' }
}

export async function askHaiku($: EngineInterface, args: AskArgs): Promise<Asked> {
  return askModel($, 'haiku', args)
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(text)
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** 답에서 JSON 객체를 꺼낸다: 처음~끝 중괄호 통째로, 안 되면 중괄호 한 쌍씩. 없으면 undefined. */
export function firstJsonObject(text: string): Record<string, unknown> | undefined {
  const whole = text.match(/\{[\s\S]*\}/)
  const found = whole ? parseObject(whole[0]) : undefined
  if (found) return found
  for (const piece of text.match(/\{[^{}]*\}/g) ?? []) {
    const obj = parseObject(piece)
    if (obj) return obj
  }
  return undefined
}
