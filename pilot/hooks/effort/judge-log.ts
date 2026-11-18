// 판정 기록: 실패한 판정과 세션의 첫 판정을 <.claude>/pilot-data/judge-log.jsonl 에 한 줄씩 남긴다.
// 왜 실패하는지(진짜 느린지·다른 이유로 끊기는지·API 혼잡인지) 가르려고 둔다. 질문 글은 남기지 않고 길이만 적는다.
import type { EngineInterface } from 'claude-code'

import { snapshotDir } from '../snapshot'

const LOG_FILE = 'judge-log.jsonl'
const LOG_KEEP_LINES = 300

export type JudgeLogRow = {
  /** 기록한 때(ISO) */
  at: string
  /** 'main' = 질문 판정, 'helper' = 하위 에이전트 판정 */
  kind: 'main' | 'helper'
  /** 세션 시작(session.start)부터 판정 시작까지(ms). 모르면 null */
  sessionAgeMs: number | null
  /** 이번 세션에서 몇 번째 판정인가 */
  judgeNo: number
  /** 판정에 넘긴 질문 길이(글자 수) */
  promptChars: number
  /** 메인 턴이 도는 중에 보낸 질문인가 */
  turnRunning: boolean
  /** 화면이 기다리다 포기했나(이번엔 앱 설정대로 보냄) */
  gaveUp: boolean
  /** 실제 요청이 끝난 모습: 'ok' 또는 실패 사유(aborted·api-error 529·empty-reply·unreadable…) */
  result: string
  /** 요청이 끝나기까지 걸린 시간(ms) */
  ms: number
}

let chain: Promise<void> = Promise.resolve()

/** 한 줄 덧붙이기. 동시에 여러 번 불려도 차례로 쓴다. 쓰다 실패해도 판정에는 영향 없음. */
export function logJudge($: EngineInterface, row: JudgeLogRow): Promise<void> {
  chain = chain.then(() => appendRow($, row)).catch(() => undefined)
  return chain
}

async function appendRow($: EngineInterface, row: JudgeLogRow): Promise<void> {
  const path = `${snapshotDir($.plugin.root)}/${LOG_FILE}`
  const old = await $.fs.read(path).catch(() => '')
  const lines = [...old.split('\n').filter(l => l.trim() !== ''), JSON.stringify(row)].slice(-LOG_KEEP_LINES)
  await $.fs.write(path, `${lines.join('\n')}\n`)
}
