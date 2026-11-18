// Haiku 판정: 다음 질문에 맞는 effort 하나와 짧은 이유(한국어).
// 판정 기준은 effortless(HeyCubit, MIT)의 판정 프롬프트를 바탕으로 effort 만 고르게 줄였다. NOTICE 참고.
import type { EngineInterface } from 'claude-code'

import type { Effort, Pick } from '../../types'
import { askHaiku, firstJsonObject } from '../haiku'
import type { Asked } from '../haiku'
import { logJudge } from './judge-log'
import type { JudgeLogRow } from './judge-log'
import { isEffort } from './levels'

// 화면이 판정을 기다리는 시간(질문 전송을 이만큼 붙잡는다). 평소 판정은 1초 안팎.
const JUDGE_WAIT_MS = 6000
// 포기한 뒤에도 요청은 이만큼 더 지켜보며 결국 어떻게 끝났는지 기록한다(늦게 온 답은 쓰지 않음).
const JUDGE_WATCH_MS = 30_000
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

export type Judged = { verdict: Verdict } | { fail: string; ms: number }

/** 기록에 남길 판정 상황(질문 글은 남기지 않는다). */
export type JudgeInfo = { kind: JudgeLogRow['kind']; sessionAgeMs: number | null; judgeNo: number; turnRunning: boolean }

/** 포기한 판정 사유: 화면이 JUDGE_WAIT_MS 동안 답을 못 받음. */
export const GAVE_UP = 'slow'

function outcome(asked: Asked): { result: string; verdict?: Verdict } {
  if ('fail' in asked) return { result: asked.fail }
  const verdict = parseVerdict(asked.text)
  return verdict ? { result: 'ok', verdict } : { result: 'unreadable' }
}

/** 판정. JUDGE_WAIT_MS 안에 답이 없으면 포기하고(fail: GAVE_UP), 요청은 뒤에서 끝까지 지켜보며 기록한다.
 *  실패와 세션의 첫 판정은 judge-log 에 남긴다. */
export async function judge($: EngineInterface, question: string, info: JudgeInfo): Promise<Judged> {
  const started = await $.clock.now()
  const call = askHaiku($, { system: JUDGE_SYSTEM, prompt: question, maxTokens: JUDGE_MAX_TOKENS, timeoutMs: JUDGE_WATCH_MS })
  const first = await Promise.race([call, $.clock.sleep(JUDGE_WAIT_MS).then(() => null)])
  const base = { ...info, at: new Date().toISOString(), promptChars: question.length }
  if (first === null) {
    void watchLate($, call, started, base).catch(() => undefined)
    return { fail: GAVE_UP, ms: JUDGE_WAIT_MS }
  }
  const ms = (await $.clock.now()) - started
  const { result, verdict } = outcome(first)
  if (!verdict || info.judgeNo === 1) await logJudge($, { ...base, gaveUp: false, result, ms }).catch(() => undefined)
  return verdict ? { verdict } : { fail: result, ms }
}

async function watchLate($: EngineInterface, call: Promise<Asked>, started: number, base: JudgeInfo & { at: string; promptChars: number }): Promise<void> {
  const asked = await call
  const ms = (await $.clock.now()) - started
  await logJudge($, { ...base, gaveUp: true, result: outcome(asked).result, ms })
}
