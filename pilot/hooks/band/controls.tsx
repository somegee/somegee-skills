// effort·근거 줄의 근거, 경고 줄, 버튼, 인계 띠.
import type { HandoffStage, LimitRow, Pick } from '../../types'
import type { HandoffAfter } from '../config'
import { cacheSafe } from '../effort/levels'
import { hottest } from '../limits'
import { T } from '../text'
import { drawParts } from './effort-row'
import type { Part } from './effort-row'
import { C } from './look'
import type { Els } from './look'

const COLD_ALERT_FROM_PERCENT = 20

export type Alert =
  | { kind: 'handoff'; stage: HandoffStage }
  | { kind: 'limit'; limit: LimitRow }
  | { kind: 'cold' }
  | { kind: 'hint'; why: string }
  | { kind: 'judge-down'; why: string }

export type AlertInput = {
  stage: HandoffStage | null
  limitGuard: boolean
  isSaving: boolean
  limits: readonly LimitRow[]
  cacheMin: number | null
  contextPercent: number
  hint: string | null
  judgeDown: string | null
}

/** 가장 급한 경고 하나. 없으면 null. */
export function pickAlert(a: AlertInput): Alert | null {
  if (a.stage) return { kind: 'handoff', stage: a.stage }
  const hot = a.limitGuard && !a.isSaving ? hottest(a.limits) : null
  if (hot) return { kind: 'limit', limit: hot }
  if (a.cacheMin === 0 && a.contextPercent >= COLD_ALERT_FROM_PERCENT) return { kind: 'cold' }
  if (a.hint) return { kind: 'hint', why: a.hint }
  if (a.judgeDown) return { kind: 'judge-down', why: a.judgeDown }
  return null
}

export function alertText(alert: Alert): { text: string; color: string } {
  switch (alert.kind) {
    case 'handoff':
      return { text: alert.stage === 'writing' ? T.handoffWriting : T.handoffClearing, color: C.accent }
    case 'limit':
      return { text: `${T.limitAlert(alert.limit.label, alert.limit.percent)} — ${T.limitSaveHint}`, color: C.hot }
    case 'cold':
      return { text: T.coldAlert, color: C.cold }
    case 'hint':
      return { text: T.hintAlert(alert.why), color: C.accent }
    case 'judge-down':
      return { text: T.judgeDown(alert.why), color: C.warn }
  }
}

/** effort 뒤에 이어 붙는 근거(effort 값은 앞에 따로 보이므로 여기엔 넣지 않는다). */
export function reasonText(pick: Pick | null, isAuto: boolean, modelId: string, savingUntil: string | null): string {
  if (savingUntil && isAuto) return T.saving(savingUntil)
  if (!isAuto) return pick?.by === 'manual' ? '직접 고른 값으로 보냄 (자동 꺼짐)' : `${T.autoOff} — 앱 설정대로 보냄`
  if (modelId && !cacheSafe(modelId)) return T.pausedWhy
  if (!pick) return '첫 질문부터 Haiku 가 effort 를 고릅니다'
  // '짧은 조회'. 누가 골랐는지(Haiku)는 덜 중요해서 뺐다(2026-10-30), '근거:' 머리말도 뺐다(2026-11-03).
  return pick.why || '판정'
}

export type Actions = {
  toggleAuto: () => void
  openHandoff: () => void
  startHandoff: (full: boolean) => void
  closePanel: () => void
  toggleSave: () => void
}

type RowInput = { key: string; left: readonly Part[]; isAuto: boolean; alert: Alert | null; showButtons: boolean }

export function actionRow(els: Els, r: RowInput, act: Actions) {
  const { Box, Text, Button } = els
  const isHint = r.alert?.kind === 'hint' || r.alert?.kind === 'cold'
  return (
    <Box key={r.key} justifyContent="space-between" flexWrap="wrap" columnGap={1}>
      <Box flexShrink={1}>{drawParts(els, r.left)}</Box>
      {!r.showButtons ? null : (
        // 강조는 바탕색(variant="primary") 대신 굵은 글씨로: 바탕색은 시선을 너무 끈다(2026-10-30 결정).
        <Box columnGap={1} flexShrink={0}>
          {r.alert?.kind === 'limit' ? (
            <Button key="save" onPress={act.toggleSave}>
              <Text bold>절약 켜기</Text>
            </Button>
          ) : null}
          <Button key="auto" onPress={act.toggleAuto}>
            <Text bold={r.isAuto}>{r.isAuto ? T.autoOn : T.autoOff}</Text>
          </Button>
          <Button key="handoff" onPress={act.openHandoff}>
            <Text bold={isHint} color={isHint ? C.accent : undefined}>
              {T.handoff}
            </Text>
          </Button>
        </Box>
      )}
    </Box>
  )
}

export function handoffPanel({ Box, Text, Button }: Els, note: { after: HandoffAfter; model: string | null }, act: Actions) {
  // 인계가 무엇인지(새 대화에서 다시 시작)를 맨 위에, 버튼 아래엔 두 방식의 차이만.
  const ways = [`${T.handoffQuick} — ${T.handoffQuickNote(note.model ?? T.handoffSessionModel)}`, `${T.handoffFull} — ${T.handoffFullNote}`]
  return (
    <Box key="handoff-panel" flexDirection="column">
      <Text>
        <Text color={C.accent} bold>{`${T.handoff}: `}</Text>
        {T.handoffAbout}
      </Text>
      <Text dimColor>{T.handoffAfterNote[note.after]}</Text>
      <Box columnGap={1} marginTop={1}>
        <Button key="handoff-quick" onPress={() => act.startHandoff(false)}>
          <Text bold>{T.handoffQuick}</Text>
        </Button>
        <Button key="handoff-full" label={T.handoffFull} onPress={() => act.startHandoff(true)} />
        <Button key="handoff-close" role="dismiss" label={T.close} onPress={act.closePanel} />
      </Box>
      {ways.map(line => (
        <Text dimColor>{`· ${line}`}</Text>
      ))}
    </Box>
  )
}
