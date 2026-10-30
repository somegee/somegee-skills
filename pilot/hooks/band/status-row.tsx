// 1줄: 폴더·브랜치 │ 모델·effort │ 컨텍스트 │ 캐시 │ 한도 │ 버전. 좁으면 조각 단위로 다음 줄에 넘긴다.
import type { Effort, Pick, StatusData } from '../../types'
import type { ContextFormat } from '../config'
import { cacheSafe } from '../effort/levels'
import { kilo } from '../status/statusline'
import { EFFORT_LABEL, T } from '../text'
import { C, ICON, SEP, cacheColor, cells, percentColor } from './look'
import type { Els } from './look'

export type Part = { text: string; color?: string; dim?: boolean }
export type Segment = { key: string; parts: readonly Part[] }

export type EffortView = {
  pick: Pick | null
  isAuto: boolean
  isJudging: boolean
  isSaving: boolean
  appEffort: string | null
}

const label = (e: string | null) => (e && e in EFFORT_LABEL ? EFFORT_LABEL[e as Effort] : e ?? '')

/** 모델 옆에 붙는 effort 글자. */
export function effortText(v: EffortView, modelId: string): Part {
  if (v.isJudging) return { text: T.judging, dim: true }
  const save = v.isSaving ? ` · ${T.saveOn}` : ''
  if (v.isAuto && v.pick && v.pick.by !== 'manual') {
    if (!cacheSafe(modelId)) return { text: `${label(v.appEffort)} (${T.autoPaused})`, color: C.effort }
    return { text: `${label(v.pick.effort)} ${T.auto}${save}`, color: C.effort }
  }
  return { text: label(v.appEffort ?? v.pick?.effort ?? null), color: C.effort }
}

/** 컨텍스트 글자: 토큰(100k/1000k) · 퍼센트(10%) · 둘 다. */
export function contextText(s: StatusData, format: ContextFormat): string {
  const tokens = `${kilo(s.contextTokens)}/${kilo(s.contextWindow)}`
  if (format === 'percent') return `${s.contextPercent}%`
  return format === 'both' ? `${tokens} ${s.contextPercent}%` : tokens
}

export type SegmentLook = { withIcons: boolean; format: ContextFormat; showCache: boolean; showLimits: boolean }

export function statusSegments(s: StatusData, v: EffortView, cacheMin: number | null, look: SegmentLook): Segment[] {
  const { withIcons, format } = look
  const icon = (glyph: string) => (withIcons ? `${glyph} ` : '')
  const segs: Segment[] = []
  const place: Part[] = []
  if (s.folder) place.push({ text: `${icon(ICON.folder)}${s.folder}`, color: C.folder })
  if (s.branch) place.push({ text: `${place.length ? ' ' : ''}${icon(ICON.branch)}${s.branch}`, color: C.branch })
  if (place.length) segs.push({ key: 'place', parts: place })
  if (s.model) {
    const effort = effortText(v, s.modelId)
    segs.push({ key: 'model', parts: [{ text: `${icon(ICON.model)}${s.model}`, color: C.model }, ...(effort.text ? [{ text: ' · ' }, effort] : [])] })
  }
  if (s.contextWindow > 0) {
    const color = percentColor(s.contextPercent, C.context)
    segs.push({ key: 'context', parts: [{ text: `${icon(ICON.context)}${contextText(s, format)}`, color }] })
  }
  if (look.showCache && cacheMin !== null) {
    segs.push({ key: 'cache', parts: [{ text: cacheMin === 0 ? T.cacheCold : T.cache(cacheMin), color: cacheColor(cacheMin) }] })
  }
  if (look.showLimits && s.limits.length) {
    const parts: Part[] = []
    s.limits.forEach((l, i) => {
      if (i) parts.push({ text: ' · ', dim: true })
      parts.push({ text: `${l.label} ${l.percent}%`, color: percentColor(l.percent, C.limit) })
    })
    segs.push({ key: 'limits', parts })
  }
  if (s.version) segs.push({ key: 'version', parts: [{ text: `${icon(ICON.version)}${s.version}`, color: C.version }] })
  return segs
}

const segCells = (seg: Segment) => cells(seg.parts.map(p => p.text).join(''))

/** 조각을 폭에 맞춰 줄로 나눈다(조각은 쪼개지 않는다). */
export function wrapSegments(segs: readonly Segment[], columns: number): Segment[][] {
  const lines: Segment[][] = []
  let line: Segment[] = []
  let width = 0
  for (const seg of segs) {
    const w = segCells(seg)
    const add = line.length ? cells(SEP) + w : w
    if (line.length && width + add > columns) {
      lines.push(line)
      line = [seg]
      width = w
    } else {
      line.push(seg)
      width += add
    }
  }
  if (line.length) lines.push(line)
  return lines
}

// Text 는 key 를 받지 않는다(글자로 찾는다).
function drawPart({ Text }: Els, p: Part) {
  return (
    <Text color={p.color} dimColor={p.dim}>
      {p.text}
    </Text>
  )
}

export function statusRows(els: Els, segs: readonly Segment[], columns: number) {
  const { Box, Text } = els
  return wrapSegments(segs, columns).map((line, li) => (
    <Box key={`status-${li}`}>
      <Text wrap="truncate-end">
        {line.flatMap((seg, si) => [...(si ? [<Text dimColor>{SEP}</Text>] : []), ...seg.parts.map(p => drawPart(els, p))])}
      </Text>
    </Box>
  ))
}
