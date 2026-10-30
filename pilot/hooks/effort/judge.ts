// Haiku 판정: 다음 질문에 맞는 effort 하나와 짧은 이유(한국어).
// 판정 기준은 effortless(HeyCubit, MIT)의 판정 프롬프트를 바탕으로 effort 만 고르게 줄였다. NOTICE 참고.
import type { EngineInterface } from 'claude-code'

import type { Effort, Pick } from '../../types'
import { askHaiku, firstJsonObject } from '../haiku'
import { isEffort } from './levels'

const JUDGE_TIMEOUT_MS = 6000
// 생각(adaptive reasoning)이 몫을 먹어 JSON 이 잘리지 않게 넉넉히.
const JUDGE_MAX_TOKENS = 300
const WHY_MAX = 40

export const JUDGE_SYSTEM = `You choose the reasoning effort for an agentic coding assistant (it reads files, runs tools and edits things) for the user's next message. The model is fixed; pick only the effort, the cheapest one that will still do the job well.

Levels: low for quick answers that need no tools and no planning; medium for normal work; high for hard problems, multi-step or tool-heavy jobs where mistakes are costly; xhigh or max only for very hard ones.

Judge the scope and the amount of work, not the length of the message or whether it is code. "Review the whole repo" or "migrate everything" is big (high), even if short.

If the message answers a question in the assistant's last reply (picks an option, confirms a plan), judge the work that answer starts, as the reply describes it: "B" can start a big build (high), while "yes" to one small action is low. Approving a plan takes that plan's effort.

A message that pushes back on or corrects ongoing work keeps at least that work's effort. Thanks or a closing remark is low. A question about how to do something that needs no tools is low.

If the user asks for deep thought ("think hard", "ultrathink", "깊게", "꼼꼼히"), pick at least high; if they ask for a quick answer, pick low.

The user writes Korean or English. Reply with JSON only: {"effort":"low|medium|high|xhigh|max","sure":0.0-1.0,"why":"reason in Korean, at most 6 words"}`

export type Verdict = { effort: Effort; why: string; sure?: number }

const EFFORT_IN_TEXT = /"effort"\s*:\s*"(low|medium|high|xhigh|max)"/i

export function parseVerdict(text: string): Verdict | undefined {
  const raw = firstJsonObject(text)
  const effort = typeof raw?.effort === 'string' ? raw.effort.trim().toLowerCase() : undefined
  if (!raw || !isEffort(effort)) {
    // 답이 중간에 잘려 JSON 이 깨졌어도 effort 값이 보이면 쓴다.
    const level = text.match(EFFORT_IN_TEXT)?.[1]?.toLowerCase()
    return isEffort(level) ? { effort: level, why: '' } : undefined
  }
  const sure = typeof raw.sure === 'number' && raw.sure >= 0 && raw.sure <= 1 ? { sure: raw.sure } : {}
  const why = typeof raw.why === 'string' ? raw.why.trim().slice(0, WHY_MAX) : ''
  return { effort, why, ...sure }
}

type Row = { role: string; text: string }

/** 판정자가 함께 읽는 앞뒤: 사람의 직전 질문(짧게)과 직전 답의 끝(질문·선택지가 거기 있다). */
export function contextFrom(messages: readonly Row[]): string {
  const lastUser = [...messages].reverse().find(m => m.role === 'user' && m.text.trim())
  const lastAnswer = lastAnswerOf(messages)
  return [lastUser ? `user: ${lastUser.text.slice(0, 400)}` : '', lastAnswer ? `assistant: ${lastAnswer.slice(-2000)}` : '']
    .filter(Boolean)
    .join('\n')
}

export function lastAnswerOf(messages: readonly Row[]): string {
  return [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text ?? ''
}

export function judgeQuestion(prompt: string, current: Pick | null, model: string, context: string): string {
  return [
    context ? `Recent conversation:\n${context}` : '',
    `Current: ${model || 'unknown model'}${current ? ` at ${current.effort}` : ''}`,
    `Next message:\n${prompt.slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function helperQuestion(prompt: string, type: string): string {
  return `A subagent (type: ${type}) is about to start this task on its own and report back. Pick its effort.\n\nTask:\n${prompt.slice(0, 4000)}`
}

export type Judged = { verdict: Verdict } | { fail: string }

export async function judge($: EngineInterface, question: string): Promise<Judged> {
  const asked = await askHaiku($, { system: JUDGE_SYSTEM, prompt: question, maxTokens: JUDGE_MAX_TOKENS, timeoutMs: JUDGE_TIMEOUT_MS })
  if ('fail' in asked) return asked
  const verdict = parseVerdict(asked.text)
  return verdict ? { verdict } : { fail: 'unreadable' }
}
