// 맨 윗줄: 실제로 보낸 effort + 근거(예: 'low 자동 · 짧은 조회'). 폴더·모델·컨텍스트는 원래 상태줄(statusLine)이 보인다(2026-11-02).
import type { Effort, Pick } from '../../types'
import { cacheSafe } from '../effort/levels'
import { EFFORT_LABEL, T } from '../text'
import { C } from './look'
import type { Els } from './look'

export type Part = { text: string; color?: string; dim?: boolean }

export type EffortView = {
  pick: Pick | null
  isAuto: boolean
  isJudging: boolean
  isSaving: boolean
  appEffort: string | null
}

const label = (e: string | null) => (e && e in EFFORT_LABEL ? EFFORT_LABEL[e as Effort] : e ?? '')

/** effort 글자. */
export function effortText(v: EffortView, modelId: string): Part {
  if (v.isJudging) return { text: T.judging, dim: true }
  const save = v.isSaving ? ` · ${T.saveOn}` : ''
  if (v.isAuto && v.pick && v.pick.by !== 'manual') {
    if (!cacheSafe(modelId)) return { text: `${label(v.appEffort)} (${T.autoPaused})`, color: C.effort }
    return { text: `${label(v.pick.effort)} ${T.auto}${save}`, color: C.effort }
  }
  return { text: label(v.appEffort ?? v.pick?.effort ?? null), color: C.effort }
}

/** effort 뒤에 이어 붙일 근거. 판단 중이면 근거 없이 '판단 중…'만. */
export function effortParts(effort: Part, reason: string, isJudging: boolean): Part[] {
  if (isJudging || !reason) return [effort]
  if (!effort.text) return [{ text: reason, dim: true }]
  return [effort, { text: ' · ', dim: true }, { text: reason, dim: true }]
}

// Text 는 key 를 받지 않는다(글자로 찾는다).
export function drawParts({ Text }: Els, parts: readonly Part[]) {
  return (
    <Text wrap="truncate-end">
      {parts.map(p => (
        <Text color={p.color} dimColor={p.dim}>
          {p.text}
        </Text>
      ))}
    </Text>
  )
}
