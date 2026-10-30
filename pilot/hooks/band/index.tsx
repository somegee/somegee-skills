// 입력창 위 막대 하나(notes 처럼 둥근 테두리): 상태줄 ─ 이유·버튼(또는 인계 띠) ─ 다음 할 일.
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { HANDOFF_MODELS, choiceLabel } from '../config'
import { clockText } from '../limits'
import { readAppEffort, readAuto, readCacheUntil, readHint, readJudgeDown, readJudging, readNext, readPanel, readPick, readSaveUntil, readStage, readStatus } from '../state'
import type { Ctx } from '../state'
import { minutesLeft } from '../status/cache'
import { makeActions } from './actions'
import { actionRow, alertText, handoffPanel, pickAlert, reasonText } from './controls'
import { nextRow, rule } from './extras'
import { C, FRAME_CELLS } from './look'
import type { Els } from './look'
import { statusRows, statusSegments } from './status-row'

export async function drawBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, ctx: Ctx, below: RenderElement): Promise<RenderElement> {
  if (e.props.hasSurvey || !ctx.isHuman) return below
  const s = await readStatus($)
  if (!s) return below
  const [p, auto, judging, down, app, until, save, view, stage, hint, open, now] = await Promise.all([
    readPick($),
    readAuto($),
    readJudging($),
    readJudgeDown($),
    readAppEffort($),
    readCacheUntil($),
    readSaveUntil($),
    readNext($),
    readStage($),
    readHint($),
    readPanel($),
    $.clock.now().catch(() => Date.now()),
  ])
  const els = $.ui.resolve(e) as unknown as Els
  const { Box } = els
  // 테두리(양옆 1칸)와 안쪽 여백(양옆 1칸)을 뺀 폭.
  const inner = Math.max(16, e.props.bodyColumns - FRAME_CELLS)
  const isSaving = save !== null && now < save
  const cacheMin = minutesLeft(until, now)
  const { contextFormat, showCache, showLimits } = ctx.config
  const segs = statusSegments(s, { pick: p, isAuto: auto, isJudging: judging, isSaving, appEffort: app }, cacheMin, {
    withIcons: e.surface === 'terminal',
    format: contextFormat,
    showCache,
    showLimits,
  })
  const alert = pickAlert({
    stage,
    limitGuard: ctx.config.limitGuard,
    isSaving,
    limits: s.limits,
    // 캐시 표시를 끄면 캐시 만료 알림도 내지 않는다.
    cacheMin: showCache ? cacheMin : null,
    contextPercent: s.contextPercent,
    hint: ctx.config.handoffHint ? hint : null,
    judgeDown: down,
  })
  const left = alert ? alertText(alert) : { text: reasonText(p, auto, s.modelId, isSaving && save !== null ? clockText(save) : null) }
  const act = makeActions($, ctx)
  const handoffNote = { after: ctx.config.handoffAfter, model: ctx.config.handoffModel === 'session' ? null : choiceLabel(HANDOFF_MODELS, ctx.config.handoffModel) }
  // 근거·버튼 줄을 꺼 두면 경고가 있을 때만 그 줄을 보인다(인계·자동은 /pilot 명령으로).
  const isRowShown = ctx.config.showActionRow || alert !== null
  const middle =
    open === 'handoff'
      ? handoffPanel(els, handoffNote, act)
      : isRowShown
        ? actionRow(els, { left, isAuto: auto, alert, isBusy: stage !== null }, act)
        : null
  const next = e.props.isWorking || open !== null ? null : nextRow(els, view, act.take, act.dismissNext)

  return (
    <Box flexDirection="column">
      {below}
      <Box key="pilot-frame" flexDirection="column" borderStyle="round" borderColor={C.border} paddingX={1}>
        {statusRows(els, segs, inner)}
        {middle ? rule(els, inner) : null}
        {middle}
        {next ? rule(els, inner) : null}
        {next}
      </Box>
    </Box>
  )
}
