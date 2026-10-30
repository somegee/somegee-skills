// 설정(plugin.json userConfig, /config 에서 바꿈) → 코드가 쓰는 값. 화면 선택지는 한국어, 안쪽 값은 영어로 바꿔 둔다.
import type { PluginOptions } from 'claude-code'

import type { Effort } from '../types'
import { EFFORTS, isEffort } from './effort/levels'
import type { ModelKey } from './haiku'

export type HandoffAfter = 'confirm' | 'continue' | 'copy'
export type ContextFormat = 'tokens' | 'percent' | 'both'
/** session = 지금 대화 모델(엔진 기본 동작). */
export type ModelChoice = 'session' | ModelKey

export type Config = {
  autoEffort: boolean
  floor: Effort
  ceiling: Effort
  subagentEffort: boolean
  nextSteps: boolean
  handoffHint: boolean
  handoffAfter: HandoffAfter
  handoffModel: ModelChoice
  limitGuard: boolean
  compactModel: ModelChoice
  contextFormat: ContextFormat
  showCache: boolean
  showLimits: boolean
}

const DEFAULT_FLOOR: Effort = 'low'
const DEFAULT_CEILING: Effort = 'high'

/** 최저·최고를 읽는다. 최저가 최고보다 높으면 맞바꾼다. */
function readLevels(floorValue: unknown, ceilingValue: unknown): readonly [Effort, Effort] {
  const floor = isEffort(floorValue) ? floorValue : DEFAULT_FLOOR
  const ceiling = isEffort(ceilingValue) ? ceilingValue : DEFAULT_CEILING
  return EFFORTS.indexOf(floor) <= EFFORTS.indexOf(ceiling) ? [floor, ceiling] : [ceiling, floor]
}

export const AFTERS: Readonly<Record<string, HandoffAfter>> = {
  '정리 후 대기': 'confirm',
  '정리 후 계속': 'continue',
  '복사만': 'copy',
}

export const HANDOFF_MODELS: Readonly<Record<string, ModelChoice>> = {
  '대화 모델': 'session',
  Haiku: 'haiku',
  Sonnet: 'sonnet',
  Opus: 'opus',
}
export const COMPACT_MODELS: Readonly<Record<string, ModelChoice>> = {
  원래대로: 'session',
  Haiku: 'haiku',
  Sonnet: 'sonnet',
  Opus: 'opus',
}

export const CONTEXT_FORMATS: Readonly<Record<string, ContextFormat>> = {
  '토큰 (100k/1000k)': 'tokens',
  '퍼센트 (10%)': 'percent',
  '둘 다': 'both',
}

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

export function readConfig(options: PluginOptions | undefined): Config {
  const o = options ?? {}
  const [floor, ceiling] = readLevels(o.effortFloor, o.effortCeiling)
  return {
    autoEffort: flag(o.autoEffort, true),
    floor,
    ceiling,
    subagentEffort: flag(o.subagentEffort, true),
    nextSteps: flag(o.nextSteps, true),
    handoffHint: flag(o.handoffHint, true),
    handoffAfter: AFTERS[String(o.handoffAfter)] ?? 'confirm',
    handoffModel: HANDOFF_MODELS[String(o.handoffModel)] ?? 'session',
    limitGuard: flag(o.limitGuard, true),
    compactModel: COMPACT_MODELS[String(o.compactModel)] ?? 'session',
    contextFormat: CONTEXT_FORMATS[String(o.contextFormat)] ?? 'tokens',
    // 원래 상태줄에 없던 표시라 기본은 끔(2026-10-30 결정). 켜면 막대에 보인다.
    showCache: flag(o.showCache, false),
    showLimits: flag(o.showLimits, false),
  }
}

/** 안쪽 값 → 화면 선택지 글자. */
export function choiceLabel(table: Readonly<Record<string, string>>, value: string): string {
  return Object.keys(table).find(k => table[k] === value) ?? value
}
