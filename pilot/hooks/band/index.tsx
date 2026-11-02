// 입력창 위 막대 하나(notes 처럼 둥근 테두리): effort·근거 ─ 경고(또는 인계 띠) ─ 다음 할 일.
// 폴더·모델·컨텍스트 줄은 원래 상태줄(statusLine)로 돌려보냈다(2026-11-02).
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { HANDOFF_MODELS, choiceLabel } from '../config'
import { clockText } from '../limits'
import { readAppEffort, readAuto, readCacheUntil, readHint, readJudgeDown, readJudging, readNext, readPanel, readPick, readSaveUntil, readStage, readStatus } from '../state'
import type { Ctx } from '../state'
import { minutesLeft } from '../status/cache'
import { makeActions } from './actions'
import { actionRow, alertText, handoffPanel, pickAlert, reasonText } from './controls'
import { effortParts, effortText } from './effort-row'
import { nextRow, rule } from './extras'
import { C, FRAME_CELLS } from './look'
import type { Els } from './look'

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
  const alert = pickAlert({
    stage,
    limitGuard: ctx.config.limitGuard,
    isSaving,
    limits: s.limits,
    // 캐시 알림을 끄면 캐시 만료 경고도 내지 않는다.
    cacheMin: ctx.config.showCache ? minutesLeft(until, now) : null,
    contextPercent: s.contextPercent,
    hint: ctx.config.handoffHint ? hint : null,
    judgeDown: down,
  })
  const act = makeActions($, ctx)
  const isBusy = stage !== null
  const effort = effortText({ pick: p, isAuto: auto, isJudging: judging, isSaving, appEffort: app }, s.modelId)
  const reason = reasonText(p, auto, s.modelId, isSaving && save !== null ? clockText(save) : null)
  // 버튼은 설정(showActionRow)을 켰을 때 맨 윗줄에, 경고가 있으면 경고 줄에 붙는다.
  const top = actionRow(
    els,
    { key: 'effort', left: effortParts(effort, reason, judging), isAuto: auto, alert: null, showButtons: ctx.config.showActionRow && alert === null && !isBusy },
    act,
  )
  const handoffNote = { after: ctx.config.handoffAfter, model: ctx.config.handoffModel === 'session' ? null : choiceLabel(HANDOFF_MODELS, ctx.config.handoffModel) }
  const middle =
    open === 'handoff'
      ? handoffPanel(els, handoffNote, act)
      : alert
        ? actionRow(els, { key: 'alert', left: [alertText(alert)], isAuto: auto, alert, showButtons: !isBusy }, act)
        : null
  const next = e.props.isWorking || open !== null ? null : nextRow(els, view, act.take, act.dismissNext)

  return (
    <Box flexDirection="column">
      {below}
      <Box key="pilot-frame" flexDirection="column" borderStyle="round" borderColor={C.border} paddingX={1}>
        {top}
        {middle ? rule(els, inner) : null}
        {middle}
        {next ? rule(els, inner) : null}
        {next}
      </Box>
    </Box>
  )
}
