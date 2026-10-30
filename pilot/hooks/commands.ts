// /pilot 명령: 설정 · 인계 [꼼꼼] · 자동 · 절약 · 상태.
import type { EngineInterface } from 'claude-code'

import { toggleAuto } from './effort/auto'
import { isEffort } from './effort/levels'
import { startHandoff } from './handoff/flow'
import { isSavingNow, toggleSave } from './limits'
import { readAuto, readPick } from './state'
import type { Ctx } from './state'
import { modelLabel } from './status/statusline'
import { EFFORT_LABEL } from './text'

export const COMMAND = {
  name: 'pilot',
  description: 'pilot 막대: 인계 [꼼꼼] · 자동(켜기/끄기) · 절약(켜기/끄기) · 상태 (설정은 /config)',
  argumentHint: '인계 [꼼꼼] | 자동 | 절약 | 상태',
}

const HELP = [
  '/pilot 인계 — 인계 메모를 빠르게 써서 새 대화로 넘긴다',
  '/pilot 인계 꼼꼼 — git 확인 + HANDOFF.md 새로 쓰고 넘긴다',
  '/pilot 자동 — 질문별 자동 effort 켜기/끄기',
  '/pilot 절약 — 절약 모드 켜기/끄기(effort medium 이하)',
  '/pilot 상태 — 마지막 요청에 실제로 보낸 effort 와 판정 횟수',
  '설정은 /config 에서 pilot 항목을 찾아 바꾼다.',
].join('\n')

const SETTINGS_HINT = '설정은 /config 에서 바꿉니다. 목록에서 pilot 항목(effort 자동·범위·인계 모델·압축 모델 등)을 찾으세요.'

const label = (e: string) => (isEffort(e) ? EFFORT_LABEL[e] : e)

async function report($: EngineInterface, ctx: Ctx): Promise<string> {
  const [auto, p, saving] = await Promise.all([readAuto($), readPick($), isSavingNow($)])
  const r = ctx.lastRequest
  const lines = [
    `자동 effort: ${auto ? '켜짐' : '꺼짐'}${saving ? ' (절약 중)' : ''}`,
    p ? `이번 질문의 값: ${label(p.effort)} — ${p.why || p.by}` : '이번 질문의 값: 아직 없음',
    r
      ? `마지막 요청: 앱 설정 ${label(r.appEffort)} → 실제로 보냄 ${label(r.sentEffort)} (${modelLabel(r.model)})${r.appEffort === r.sentEffort ? '' : ' · pilot 이 바꿈'}`
      : '마지막 요청: 아직 없음',
    `이번 세션 판정 횟수: ${ctx.judged}`,
  ]
  return lines.join('\n')
}

export async function runCommand($: EngineInterface, ctx: Ctx, args: string): Promise<string> {
  const [word, extra] = args.trim().split(/\s+/, 2)
  switch (word) {
    case '설정':
      return SETTINGS_HINT
    case '인계':
      await startHandoff($, ctx, extra === '꼼꼼')
      return extra === '꼼꼼' ? '꼼꼼한 인계를 시작합니다(HANDOFF.md 를 새로 씁니다).' : '빠른 인계를 시작합니다.'
    case '자동':
      return toggleAuto($)
    case '절약':
      return toggleSave($)
    case '상태':
      return report($, ctx)
    default:
      return HELP
  }
}
