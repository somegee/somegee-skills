// 질문마다 effort 자동. 질문을 보낼 때 판정하고(prompt.submit), 요청이 나가기 직전에 그 요청 하나의 effort 만 바꾼다(turn.step).
// 앱의 effort 설정은 그대로라서 /effort 로 직접 바꾸면 알아채고 자동을 끈다.
import type { AgentSpawnInput, AgentSpawnResult, EngineInterface, TurnStepInput } from 'claude-code'

import type { Effort, Pick } from '../../types'
import { isSavingNow } from '../limits'
import { readAuto, readPick, readStage, readStatus, writeAppEffort, writeAuto, writeJudgeDown, writeJudging, writePick } from '../state'
import type { Ctx } from '../state'
import { modelLabel } from '../status/statusline'
import { EFFORT_LABEL, T } from '../text'
import { contextFrom, helperQuestion, judge, judgeQuestion, lastAnswerOf } from './judge'
import { atLeast, cacheSafe, capForSave, clamp, endsOnQuestion, helperFloor, isEffort, isFollowUp, isHaiku, namedEffort } from './levels'

const DEEP_WORDS = /ultrathink/i

const HELPER_PICKS_MAX = 50

// 앱의 effort 로 마지막에 본 값과 그때의 모델. 모델이 바뀌면 앱 기본값도 바뀌므로 다시 본다. 다시 불러오면 처음부터.
let seenApp: string | undefined
let seenModel: string | undefined

/** 직접 적은 값 → 짧은 답이면 그대로 → 아니면 Haiku 판정. 판정 못 하면 null. */
async function decide($: EngineInterface, ctx: Ctx, text: string, model: string): Promise<Pick | null> {
  const named = namedEffort(text)
  if (named) return { effort: named, why: '질문에 직접 적음', by: 'named' }

  const messages = await $.session.messages().catch(() => [])
  const current = await readPick($)
  if (current && isFollowUp(text) && !endsOnQuestion(lastAnswerOf(messages))) {
    return { ...current, why: '짧은 답이라 그대로', by: current.by === 'manual' ? 'manual' : 'kept' }
  }

  await writeJudging($, true)
  try {
    const got = await judge($, judgeQuestion(text, current, modelLabel(model), contextFrom(messages)))
    ctx.judged += 1
    if ('fail' in got) {
      await writeJudgeDown($, got.fail)
      return null
    }
    await writeJudgeDown($, null)
    const { floor, ceiling } = ctx.config
    return { effort: capForSave(clamp(got.verdict.effort, floor, ceiling), await isSavingNow($)), why: got.verdict.why, by: 'judge' }
  } finally {
    await writeJudging($, false)
  }
}

/** 질문을 보낼 때. 턴이 도는 중에 보낸 질문은 지금 턴을 흔들지 않게 판정만 해 두고 턴이 끝나면 적용한다. */
export async function judgePrompt($: EngineInterface, ctx: Ctx, text: string): Promise<void> {
  const isDeep = DEEP_WORDS.test(text)
  const isHolding = ctx.isTurnRunning
  if (!isHolding) ctx.deepTurn = isDeep
  const hold = (pick: Pick | null) => {
    ctx.held = { pick, isDeep }
  }
  if (!(await readAuto($)) || (await readStage($)) !== null || isDeep) {
    if (isHolding) hold(null)
    return
  }
  // 자동이 쉬는 모델(effort 를 바꾸면 캐시가 깨짐)에선 판정 비용도 쓰지 않는다.
  const model = ctx.modelId || (await readStatus($))?.modelId || ''
  if (model && (!cacheSafe(model) || isHaiku(model))) return
  const pick = await decide($, ctx, text, model)
  if (isHolding) hold(pick)
  else if (pick) await writePick($, pick)
}

/** 메인 턴이 끝났을 때: 턴 중에 보낸 질문의 판정을 이제 적용한다. */
export async function applyHeld($: EngineInterface, ctx: Ctx): Promise<void> {
  const held = ctx.held
  ctx.held = null
  ctx.deepTurn = held?.isDeep ?? false
  if (held?.pick) await writePick($, held.pick)
}

/** 앱 effort 가 바뀌었으면 사람이 /effort 로 바꾼 것: 자동을 끄고 그 값을 따른다. ultrathink 턴은 엔진이 올린 것이라 제외. */
async function noticeManual($: EngineInterface, ctx: Ctx, seen: string, model: string): Promise<void> {
  // ultrathink 턴의 값은 앱 설정이 아니다: 기억하지 않아야 다음 턴에 '사람이 바꿨다'고 착각하지 않는다.
  if (ctx.deepTurn) return
  if (model !== seenModel) {
    seenModel = model
    seenApp = undefined
  }
  const before = seenApp
  seenApp = seen
  await writeAppEffort($, seen)
  if (before === undefined || before === seen) return
  if (await readAuto($)) {
    await writeAuto($, false)
    $.ui.toast(T.manualTook(isEffort(seen) ? EFFORT_LABEL[seen] : seen))
  }
  if (isEffort(seen)) await writePick($, { effort: seen, why: '직접 고름', by: 'manual' })
}

/** 메인 대화 요청에 보낼 effort. 바꾸지 않으면 undefined. */
async function mainEffort($: EngineInterface, ctx: Ctx, e: TurnStepInput): Promise<Effort | undefined> {
  if (ctx.deepTurn || !(await readAuto($))) return undefined
  const p = await readPick($)
  if (!p || p.by === 'manual' || isHaiku(e.model) || !cacheSafe(e.model)) return undefined
  return capForSave(p.effort, await isSavingNow($))
}

// 하위 에이전트: 띄울 때 판정해 둔 값. agent.spawn 의 결과(agentId)는 에이전트가 끝나야 오므로, 도는 동안은 설명·종류로 짝을 찾는다.
type Waiting = { description: string; type: string; effort: Effort }
let waiting: readonly Waiting[] = []
const helperPicks = new Map<string, Effort>()

function remember(id: string, effort: Effort): void {
  helperPicks.set(id, effort)
  const oldest = helperPicks.keys().next().value
  if (helperPicks.size > HELPER_PICKS_MAX && oldest !== undefined) helperPicks.delete(oldest)
}

async function helperEffortOf($: EngineInterface, id: string): Promise<Effort | undefined> {
  const known = helperPicks.get(id)
  if (known || waiting.length === 0) return known
  const info = (await $.agent.list().catch(() => [])).find(a => a.id === id)
  const match = info && waiting.find(w => w.description === info.description && w.type === info.type)
  if (!match) return undefined
  waiting = waiting.filter(w => w !== match)
  remember(id, match.effort)
  return match.effort
}

async function subagentEffort($: EngineInterface, ctx: Ctx, e: TurnStepInput & { agentId: string }): Promise<Effort | undefined> {
  if (!ctx.config.subagentEffort || !(await readAuto($)) || isHaiku(e.model)) return undefined
  const saving = await isSavingNow($)
  const own = await helperEffortOf($, e.agentId)
  if (own) return capForSave(own, saving)
  const p = await readPick($)
  if (!p || p.by === 'manual') return undefined
  const { floor, ceiling } = ctx.config
  return capForSave(clamp(atLeast(p.effort, helperFloor(floor, ceiling)), floor, ceiling), saving)
}

/** 요청이 나가기 직전: 보낼 요청(effort 를 바꿨거나 그대로). */
export async function requestFor($: EngineInterface, ctx: Ctx, e: TurnStepInput): Promise<TurnStepInput> {
  // 숫자 effort(옛 모델의 생각 예산)나 effort 를 안 받는 모델은 건드리지 않는다.
  if (typeof e.effort !== 'string') return e
  if (e.agentId !== undefined) {
    const effort = await subagentEffort($, ctx, e as TurnStepInput & { agentId: string })
    return effort ? { ...e, effort } : e
  }
  ctx.modelId = e.model
  await noticeManual($, ctx, e.effort, e.model)
  const effort = await mainEffort($, ctx, e)
  ctx.lastRequest = { appEffort: e.effort, sentEffort: effort ?? e.effort, model: e.model, at: await $.clock.now().catch(() => Date.now()) }
  return effort ? { ...e, effort } : e
}

/** 하위 에이전트를 띄우기 전에 판정. 판정 못 하면 null(그 에이전트는 메인 질문의 값을 따른다). */
export async function beforeSpawn($: EngineInterface, ctx: Ctx, e: AgentSpawnInput): Promise<Waiting | null> {
  if (!ctx.config.subagentEffort || e.fork || e.isTeammate || e.workflow || !(await readAuto($))) return null
  const got = await judge($, helperQuestion(e.prompt, e.subagentType)).catch(() => null)
  if (!got || 'fail' in got) return null
  ctx.judged += 1
  const { floor, ceiling } = ctx.config
  const effort = capForSave(clamp(atLeast(got.verdict.effort, helperFloor(floor, ceiling)), floor, ceiling), await isSavingNow($))
  const w: Waiting = { description: e.description, type: e.subagentType, effort }
  waiting = [...waiting, w].slice(-20)
  return w
}

export function afterSpawn(w: Waiting | null, result: AgentSpawnResult): void {
  if (!w) return
  waiting = waiting.filter(x => x !== w)
  if ('agentId' in result && result.agentId && !helperPicks.has(result.agentId)) remember(result.agentId, w.effort)
}

/** [자동] 버튼·/pilot 자동: 켜고 끄기. 켤 때 직접 고른 값은 내려놓는다. */
export async function toggleAuto($: EngineInterface): Promise<string> {
  const on = !(await readAuto($))
  await writeAuto($, on)
  if (on) {
    const p = await readPick($)
    if (p?.by === 'manual') await writePick($, null)
  }
  return on ? '자동 effort 를 켰어요. 다음 질문부터 Haiku 가 고릅니다.' : '자동 effort 를 껐어요. 앱 설정대로 보냅니다.'
}
