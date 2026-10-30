// 막대가 읽는 값(atom)과, 세션 안에서만 쓰는 공용 값.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { HandoffStage, NextView, Panel, Pick, StatusData } from '../types'
import type { Config } from './config'

const status = atom({ plugin: 'pilot', key: 'status' } as const, null)
const pick = atom({ plugin: 'pilot', key: 'pick' } as const, null)
const isAuto = atom({ plugin: 'pilot', key: 'isAuto' } as const, true)
const isJudging = atom({ plugin: 'pilot', key: 'isJudging' } as const, false)
const judgeDown = atom({ plugin: 'pilot', key: 'judgeDown' } as const, null)
const appEffort = atom({ plugin: 'pilot', key: 'appEffort' } as const, null)
const cacheUntil = atom({ plugin: 'pilot', key: 'cacheUntil' } as const, null)
const saveUntil = atom({ plugin: 'pilot', key: 'saveUntil' } as const, null)
const nextView = atom({ plugin: 'pilot', key: 'next' } as const, { kind: 'hidden' })
const handoffStage = atom({ plugin: 'pilot', key: 'handoffStage' } as const, null)
const handoffHint = atom({ plugin: 'pilot', key: 'handoffHint' } as const, null)
const panel = atom({ plugin: 'pilot', key: 'panel' } as const, null)

/** 기능들이 함께 쓰는 세션 값. register 가 한 번 만들어 나눠 준다. */
export type Ctx = {
  readonly config: Config
  readonly options: Readonly<Record<string, unknown>>
  /** 사람이 보는 세션인가(크론 claude -p·디스코드 릴레이는 false → 아무것도 안 함). */
  isHuman: boolean
  /** 메인 대화가 마지막으로 쓴 모델 id(turn.step 의 e.model). */
  modelId: string
  /** 이번 세션에서 사람이 보낸 질문 수(인계 추천은 두 번마다). */
  prompts: number
  /** 마지막 메인 요청: 앱이 정한 값과 실제로 보낸 값(/pilot 상태). */
  lastRequest: { appEffort: string; sentEffort: string; model: string; at: number } | null
  /** 판정 횟수(/pilot 상태). */
  judged: number
  /** 이번 질문에 ultrathink 가 있었나(엔진이 그 턴만 올리므로 건드리지 않는다). */
  deepTurn: boolean
  /** 메인 턴이 도는 중인가(turn.start ~ turn.complete). */
  isTurnRunning: boolean
  /** 턴이 도는 중에 보낸 질문의 판정: 지금 턴을 흔들지 않고 턴이 끝나면 적용한다. */
  held: { pick: Pick | null; isDeep: boolean } | null
}

export function makeCtx(config: Config, options: Readonly<Record<string, unknown>>): Ctx {
  return { config, options, isHuman: false, modelId: '', prompts: 0, lastRequest: null, judged: 0, deepTurn: false, isTurnRunning: false, held: null }
}

// 읽기·쓰기는 이 파일 안의 함수로만 한다: 검사기가 read/update 의 대상을 같은 파일의 atom 으로만 받는다.
export function readStatus($: EngineInterface): Promise<StatusData | null> {
  return read($, status)
}
export async function writeStatus($: EngineInterface, value: StatusData | null): Promise<void> {
  await update($, status, () => value)
}
export function readPick($: EngineInterface): Promise<Pick | null> {
  return read($, pick)
}
export async function writePick($: EngineInterface, value: Pick | null): Promise<void> {
  await update($, pick, () => value)
}
export function readAuto($: EngineInterface): Promise<boolean> {
  return read($, isAuto)
}
export async function writeAuto($: EngineInterface, value: boolean): Promise<void> {
  await update($, isAuto, () => value)
}
export function readJudging($: EngineInterface): Promise<boolean> {
  return read($, isJudging)
}
export async function writeJudging($: EngineInterface, value: boolean): Promise<void> {
  await update($, isJudging, () => value)
}
export function readJudgeDown($: EngineInterface): Promise<string | null> {
  return read($, judgeDown)
}
export async function writeJudgeDown($: EngineInterface, value: string | null): Promise<void> {
  await update($, judgeDown, () => value)
}
export function readAppEffort($: EngineInterface): Promise<string | null> {
  return read($, appEffort)
}
export async function writeAppEffort($: EngineInterface, value: string | null): Promise<void> {
  await update($, appEffort, () => value)
}
export function readCacheUntil($: EngineInterface): Promise<number | null> {
  return read($, cacheUntil)
}
export async function writeCacheUntil($: EngineInterface, value: number | null): Promise<void> {
  await update($, cacheUntil, () => value)
}
export function readSaveUntil($: EngineInterface): Promise<number | null> {
  return read($, saveUntil)
}
export async function writeSaveUntil($: EngineInterface, value: number | null): Promise<void> {
  await update($, saveUntil, () => value)
}
export function readNext($: EngineInterface): Promise<NextView> {
  return read($, nextView)
}
export async function writeNext($: EngineInterface, value: NextView): Promise<void> {
  await update($, nextView, () => value)
}
export function readStage($: EngineInterface): Promise<HandoffStage | null> {
  return read($, handoffStage)
}
export async function writeStage($: EngineInterface, value: HandoffStage | null): Promise<void> {
  await update($, handoffStage, () => value)
}
export function readHint($: EngineInterface): Promise<string | null> {
  return read($, handoffHint)
}
export async function writeHint($: EngineInterface, value: string | null): Promise<void> {
  await update($, handoffHint, () => value)
}
export function readPanel($: EngineInterface): Promise<Panel | null> {
  return read($, panel)
}
export async function writePanel($: EngineInterface, value: Panel | null): Promise<void> {
  await update($, panel, () => value)
}
