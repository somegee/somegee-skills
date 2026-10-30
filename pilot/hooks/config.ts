// 설정(plugin.json userConfig, /config 에서 바꿈) → 코드가 쓰는 값. 화면 선택지는 한국어, 안쪽 값은 영어로 바꿔 둔다.
import type { PluginOptions } from 'claude-code'

import type { Effort } from '../types'
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

export const RANGES: Readonly<Record<string, readonly [Effort, Effort]>> = {
  '아끼기 (low~medium)': ['low', 'medium'],
  '균형 (low~high)': ['low', 'high'],
  '똑똑하게 (medium~xhigh)': ['medium', 'xhigh'],
}
const DEFAULT_LEVELS: readonly [Effort, Effort] = ['low', 'high']

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
  const range = RANGES[String(o.effortRange)] ?? DEFAULT_LEVELS
  return {
    autoEffort: flag(o.autoEffort, true),
    floor: range[0],
    ceiling: range[1],
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
