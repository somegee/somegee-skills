// 막대 내용을 파일로 남긴다 — 다른 화면(웹 관제 화면 등)이 이 세션의 pilot 상태를 읽을 수 있게.
// 파일: <.claude>/pilot-data/live/<세션 id>.json. 내용이 바뀐 때만 쓴다. 이 PC 밖으로는 아무것도 보내지 않는다.
import type { EngineInterface } from 'claude-code'

import type { HandoffStage, NextView, Pick, StatusData } from '../types'
import { readAuto, readHint, readNext, readPick, readStage, readStatus } from './state'

export type Snapshot = {
  effort: Pick | null
  isAuto: boolean
  model: string | null
  contextPercent: number | null
  limits: readonly { label: string; percent: number; resetsAt?: string }[]
  next: { state: 'hidden' | 'loading' | 'offer'; items: readonly { label: string; prompt: string }[] }
  handoff: { stage: HandoffStage | null; hint: string | null }
}

type Parts = {
  pick: Pick | null
  isAuto: boolean
  status: StatusData | null
  next: NextView
  stage: HandoffStage | null
  hint: string | null
}

/** 막대 값들 → 남길 내용 (엔진 없이 계산) */
export function buildSnapshot(p: Parts): Snapshot {
  return {
    effort: p.pick,
    isAuto: p.isAuto,
    model: p.status?.model ?? null,
    contextPercent: p.status?.contextPercent ?? null,
    limits: p.status?.limits ?? [],
    next: p.next.kind === 'offer' ? { state: 'offer', items: p.next.items } : { state: p.next.kind, items: [] },
    handoff: { stage: p.stage, hint: p.hint },
  }
}

/** 남길 폴더 — 설치본은 버전마다 폴더가 바뀌므로 모드 폴더 밖 <.claude>/pilot-data, .claude 아래가 아니면 모드 폴더의 data/ */
export function snapshotDir(pluginRoot: string): string {
  const claudeDir = pluginRoot.match(/^(.*?[\\/]\.claude)[\\/]/)?.[1]
  return claudeDir === undefined ? `${pluginRoot}/data` : `${claudeDir}/pilot-data`
}

let lastWritten = ''

export async function writeSnapshot($: EngineInterface): Promise<void> {
  const id = (await $.session.id()).replace(/[^A-Za-z0-9-]/g, '')
  if (id === '') return
  const snap = buildSnapshot({
    pick: await readPick($),
    isAuto: await readAuto($),
    status: await readStatus($),
    next: await readNext($),
    stage: await readStage($),
    hint: await readHint($),
  })
  const key = `${id}:${JSON.stringify(snap)}`
  if (key === lastWritten) return
  lastWritten = key
  await $.fs.write(`${snapshotDir($.plugin.root)}/live/${id}.json`, JSON.stringify({ ...snap, at: new Date().toISOString() }))
}
