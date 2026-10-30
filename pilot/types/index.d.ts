// pilot 의 $.state 계약. 막대가 그릴 때 읽는 값만 여기 둔다(모듈 변수는 다시 불러오면 사라진다).

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** 이번 질문의 effort 를 누가 정했나. judge = Haiku 판정, named = 질문에 직접 적음, manual = /effort 로 직접, kept = 짧은 답이라 그대로. */
export type PickBy = 'judge' | 'named' | 'manual' | 'kept'
export type Pick = { effort: Effort; why: string; by: PickBy }

export type LimitRow = { label: string; percent: number; resetsAt?: string }

/** 상태줄 1줄에 그리는 값. statusline.py 가 보여 주던 것 + 한도. */
export type StatusData = {
  folder: string
  branch: string
  model: string
  modelId: string
  version: string
  contextTokens: number
  contextWindow: number
  contextPercent: number
  limits: readonly LimitRow[]
}

export type Suggestion = { label: string; prompt: string }
export type NextView =
  | { kind: 'hidden' }
  | { kind: 'loading'; turnId: string }
  /** picked = 입력창에 초안으로 넣은 번호(0부터). 목록은 보낼 때까지 남는다. */
  | { kind: 'offer'; items: readonly Suggestion[]; picked: number | null }

export type HandoffStage = 'writing' | 'clearing'
export type Panel = 'handoff'

declare module 'claude-code' {
  interface PluginState {
    pilot: {
      status: StatusData | null
      pick: Pick | null
      isAuto: boolean
      isJudging: boolean
      judgeDown: string | null
      appEffort: string | null
      cacheUntil: number | null
      saveUntil: number | null
      next: NextView
      handoffStage: HandoffStage | null
      handoffHint: string | null
      panel: Panel | null
    }
  }
}
