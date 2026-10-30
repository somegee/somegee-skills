// 인계 흐름: 메모 쓰기(빠르게 = fork, 꼼꼼히 = 도구 쓰는 턴) → 대화 비우기 → 새 대화 첫 메시지로 넣기.
// 프롬프트를 보내거나 /clear 하는 일은 버튼 처리 안이 아니라 세션 타이머에서 한다(버튼·명령이 턴을 쥐고 있으면 거절된다).
// 턴이 도는 중엔 시작하지 않는다: 그 턴의 답을 메모로 잘못 잡거나 /clear 가 그 턴을 끊을 수 있어서.
import type { EngineInterface, TurnCompleteInput, TurnStartInput } from 'claude-code'

import { MODELS, askHaiku, askModel } from '../haiku'
import type { ModelKey } from '../haiku'
import { readCacheUntil, readStage, readStatus, writeHint, writePanel, writeStage } from '../state'
import type { Ctx } from '../state'
import { T } from '../text'
import { fittedTranscript } from '../transcript'
import { HANDOFF_FULL_PROMPT, HANDOFF_PROMPT, HINT_EVERY, HINT_FROM_PERCENT, HINT_SYSTEM, handoffMessage, hintEvidence, parseHint, safeMemo } from './prompts'

const KICK_MS = 300
const HINT_TIMEOUT_MS = 8000
const COLD_HANDOFF_TIMEOUT_MS = 120_000
// 이 시간이 지나도 메모가 안 써지면 그만둔다(막대가 '쓰는 중'에 영영 멈추지 않게).
const WATCHDOG_MS = 5 * 60_000
const MATCH_CHARS = 40

let isFull = false
let isDriving = false
// 인계마다 하나씩 올린다. 늦게 도착한 타이머가 다음 인계를 건드리지 않게.
let generation = 0
// 메모를 한 턴으로 쓰게 보냈을 때: 보낸 글과, 그 턴이 시작되면 그 턴의 id. 그 턴의 답만 메모로 받는다.
let sentPrompt: string | null = null
let handoffTurnId: string | null = null

const fail = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 140)

async function stop($: EngineInterface): Promise<void> {
  sentPrompt = null
  handoffTurnId = null
  await writeStage($, null)
}

/** [빠르게]·[꼼꼼히]·/pilot 인계: 시작만 하고 실제 일은 타이머에서. */
export async function startHandoff($: EngineInterface, ctx: Ctx, full: boolean): Promise<void> {
  if ((await readStage($)) !== null) return
  if (ctx.isTurnRunning) {
    $.ui.toast(T.handoffWait)
    return
  }
  isFull = full
  const gen = ++generation
  await writeStage($, 'writing')
  await writePanel($, null)
  await writeHint($, null)
  $.clock.after(KICK_MS, () => void writeHandoff($, ctx).catch(error => void failed($, error)))
  $.clock.after(WATCHDOG_MS, () => void watchdog($, gen))
}

async function watchdog($: EngineInterface, gen: number): Promise<void> {
  if (gen !== generation || isDriving || (await readStage($)) !== 'writing') return
  await stop($)
  $.ui.toast(T.handoffTimeout)
}

async function failed($: EngineInterface, error: unknown): Promise<void> {
  await stop($)
  $.ui.toast(T.handoffFailed(fail(error)))
}

/** 고른 모델이 대화 글을 읽고 메모를 쓴다. 캐시가 식었을 때(fork 는 대화 전체를 비싸게 다시 읽음)와 인계 모델을 따로 골랐을 때. */
async function transcriptHandoff($: EngineInterface, key: ModelKey): Promise<string | undefined> {
  const messages = await $.session.messages().catch(() => [])
  const transcript = messages.length ? fittedTranscript(messages) : undefined
  if (!transcript) return undefined
  const got = await askModel($, key, {
    system: 'You read a conversation between a user and Claude Code, an AI coding agent, and write the handoff the user asks for.',
    prompt: `${transcript}\n\n---\n${HANDOFF_PROMPT}`,
    maxTokens: 4000,
    timeoutMs: COLD_HANDOFF_TIMEOUT_MS,
  })
  return 'text' in got ? got.text : undefined
}

/** 메모를 쓰는 한 턴을 보낸다. 다른 훅이 거절하면 실패로. */
async function submitHandoffTurn($: EngineInterface, text: string): Promise<void> {
  sentPrompt = text
  const r = await $.prompt.submit({ text })
  if ('drop' in r && r.drop) throw new Error(r.drop)
}

async function writeHandoff($: EngineInterface, ctx: Ctx): Promise<void> {
  if (isFull) return submitHandoffTurn($, HANDOFF_FULL_PROMPT)
  const chosen = ctx.config.handoffModel
  if (chosen !== 'session') {
    const text = await transcriptHandoff($, chosen)
    if (text) return finish($, ctx, text)
    $.ui.toast(T.handoffModelFailed(MODELS[chosen].label))
  } else {
    const now = await $.clock.now().catch(() => Date.now())
    const until = await readCacheUntil($)
    const text = until !== null && now >= until ? await transcriptHandoff($, 'haiku') : undefined
    if (text) return finish($, ctx, text)
  }
  const forked = await $.model.fork({ prompt: HANDOFF_PROMPT })
  if (forked.isAnswered && forked.text.trim()) return finish($, ctx, forked.text)
  // fork 할 대화가 없거나 실패: 한 턴으로 쓴다.
  return submitHandoffTurn($, HANDOFF_PROMPT)
}

/** 턴이 시작될 때: 우리가 보낸 메모 턴이면 그 id 를 기억한다. */
export function noteHandoffTurn(e: TurnStartInput): void {
  if (sentPrompt && handoffTurnId === null && e.agentId === undefined && e.text.startsWith(sentPrompt.slice(0, MATCH_CHARS))) {
    handoffTurnId = e.turnId
  }
}

/** 꼼꼼히(또는 fork 대신 턴)로 쓴 메모 턴이 끝났을 때. 그 턴이 아니면 무시. */
export async function captureHandoff($: EngineInterface, ctx: Ctx, e: TurnCompleteInput): Promise<void> {
  if (handoffTurnId === null || e.turnId !== handoffTurnId || isDriving) return
  if ((await readStage($)) !== 'writing') return
  handoffTurnId = null
  sentPrompt = null
  if (e.reason !== 'answer' || !e.answer.trim()) {
    await stop($)
    $.ui.toast(T.handoffNotWritten)
    return
  }
  const text = e.answer
  $.clock.after(KICK_MS, () => void finish($, ctx, text).catch(error => void failed($, error)))
}

/** 대화를 비울 수 없을 때: 메모를 입력창에 넣어 둔다(사람이 보고 보낼 수 있게). */
async function keepInBox($: EngineInterface, message: string, toast: string): Promise<void> {
  await $.prompt.fill({ text: message, mode: 'replace' }).catch(() => undefined)
  $.ui.toast(toast)
}

async function finish($: EngineInterface, ctx: Ctx, written: string): Promise<void> {
  if (isDriving) return
  isDriving = true
  try {
    const memo = safeMemo(written)
    const after = ctx.config.handoffAfter
    if (after === 'copy') {
      const message = handoffMessage(memo, 'continue', isFull)
      const copied = await $.ui.copy({ text: message }).catch(() => ({ isCopied: false as const }))
      if (copied.isCopied) $.ui.toast(T.handoffCopied)
      else await keepInBox($, message, T.handoffInBox)
      return
    }
    const message = handoffMessage(memo, after, isFull)
    // 메모를 쓰는 동안 사람이 새 질문을 보냈으면 /clear 가 그 턴을 끊는다: 비우지 않고 입력창에 넣는다.
    if (ctx.isTurnRunning) return keepInBox($, message, T.handoffBusy)
    await writeStage($, 'clearing')
    await $.command.run({ command: 'clear', args: '' })
    await writeHint($, null)
    const r = await $.prompt.submit({ text: message })
    if ('drop' in r && r.drop) await keepInBox($, message, T.handoffDropped)
  } finally {
    isDriving = false
    await stop($)
  }
}

/** 질문 두 번마다(대화 30% 넘었을 때) 인계 추천을 묻는다. 질문을 붙잡지 않게 뒤에서. */
export async function maybeHint($: EngineInterface, ctx: Ctx, text: string): Promise<void> {
  if (!ctx.config.handoffHint || ctx.prompts % HINT_EVERY !== 0) return
  const percent = (await readStatus($))?.contextPercent ?? 0
  if (percent < HINT_FROM_PERCENT || (await readStage($)) !== null) return
  const gen = generation
  const messages = await $.session.messages().catch(() => [])
  const got = await askHaiku($, { system: HINT_SYSTEM, prompt: hintEvidence(messages, text, percent), maxTokens: 60, timeoutMs: HINT_TIMEOUT_MS })
  if ('fail' in got) return
  const hint = parseHint(got.text)
  // 묻는 사이에 인계가 시작·끝났으면 지난 대화 이야기라 버린다.
  if (hint === undefined || gen !== generation || (await readStage($)) !== null) return
  await writeHint($, hint)
}
