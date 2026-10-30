// 막대 버튼이 하는 일. 프롬프트·명령을 보내는 일은 타이머로 미룬다(버튼 처리 중엔 거절될 수 있다).
// 설정은 /config 에서만 바꾼다(막대에 설정 띠를 두지 않는다).
import type { EngineInterface } from 'claude-code'

import { toggleAuto } from '../effort/auto'
import { startHandoff } from '../handoff/flow'
import { toggleSave } from '../limits'
import { takeSuggestion } from '../next-steps'
import { writeNext, writePanel } from '../state'
import type { Ctx } from '../state'
import type { Actions } from './controls'

const KICK_MS = 200

export type BandActions = Actions & {
  take: (index: number) => void
  dismissNext: () => void
}

export function makeActions($: EngineInterface, ctx: Ctx): BandActions {
  const toast = (text: string) => $.ui.toast(text)
  return {
    toggleAuto: () => void toggleAuto($).then(toast),
    toggleSave: () => void toggleSave($).then(toast),
    openHandoff: () => void writePanel($, 'handoff'),
    closePanel: () => void writePanel($, null),
    startHandoff: full => void startHandoff($, ctx, full),
    compact: () => {
      $.clock.after(KICK_MS, () => void $.command.run({ command: 'compact', args: '' }).catch((error: unknown) => toast(String(error))))
    },
    take: index => void takeSuggestion($, index),
    dismissNext: () => void writeNext($, { kind: 'hidden' }),
  }
}
