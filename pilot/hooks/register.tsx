// pilot: 입력창 위 한 막대에 상태줄 · 질문별 자동 effort · 캐시 · 한도 · 다음 할 일 · 인계를 한국어로.
// 이벤트마다 훅은 하나씩만 달고, 기능 함수를 차례로 부른다(같은 이벤트에 훅이 여럿이면 순서를 장담할 수 없어서).
// 사람이 보지 않는 세션(크론 claude -p 등)에선 아무것도 하지 않는다.
import type { Register } from 'claude-code'

import { drawBand } from './band/index'
import { COMMAND, runCommand } from './commands'
import { compactWith } from './compact'
import { readConfig } from './config'
import { afterSpawn, applyHeld, beforeSpawn, judgePrompt, requestFor } from './effort/auto'
import { captureHandoff, maybeHint, noteHandoffTurn } from './handoff/flow'
import { restoreSave } from './limits'
import { hideNext, offerNext } from './next-steps'
import { makeCtx, writeAuto } from './state'
import { TICK_MS, afterStep, refreshStatus, tick } from './status/tracker'

export const register: Register = (on, options) => {
  const ctx = makeCtx(readConfig(options), options ?? {})

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // notes 와 같은 기준: 화면(surface)은 시작 뒤에 붙기도 하므로 대화형 여부만 본다.
    ctx.isHuman = e.isInteractive
    if (!ctx.isHuman) return result
    await writeAuto($, ctx.config.autoEffort)
    await restoreSave($)
    await $.command.register(COMMAND)
    void refreshStatus($, ctx).catch(() => undefined)
    $.clock.every(TICK_MS, () => void tick($, ctx).catch(() => undefined))
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (!ctx.isHuman || e.isMeta || e.command) return next(e)
    ctx.prompts += 1
    await judgePrompt($, ctx, e.text).catch(() => undefined)
    void maybeHint($, ctx, e.text).catch(() => undefined)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (ctx.isHuman && e.agentId === undefined) {
      ctx.isTurnRunning = true
      noteHandoffTurn(e)
      await hideNext($)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!ctx.isHuman) return yield* next(e)
    const request = await requestFor($, ctx, e).catch(() => e)
    const result = yield* next(request)
    if (e.agentId === undefined) await afterStep($, ctx, result).catch(() => undefined)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!ctx.isHuman || e.agentId !== undefined) return result
    ctx.isTurnRunning = false
    await applyHeld($, ctx).catch(() => undefined)
    await captureHandoff($, ctx, e).catch(() => undefined)
    void refreshStatus($, ctx).catch(() => undefined)
    await offerNext($, ctx, e).catch(() => undefined)
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    if (!ctx.isHuman) return next(e)
    const waiting = await beforeSpawn($, ctx, e).catch(() => null)
    const result = await next(e)
    afterSpawn(waiting, result)
    return result
  })

  // 압축 모델을 골랐을 때만 단다: 회사 PC 보안 모듈이 이 훅을 막으면 세션마다 알림이 뜨기 때문.
  const compactModel = ctx.config.compactModel
  if (compactModel !== 'session') {
    on('session.compact', async ($, e, next) => (ctx.isHuman ? compactWith($, e, next, compactModel) : next(e)))
  }

  on('command.run', { command: 'pilot' }, async ($, e) => ({ text: await runCommand($, ctx, e.args) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => drawBand($, e, ctx, await next(e)))
}
