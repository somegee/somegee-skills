// 테스트용 가짜 엔진 답. on 에 단 훅은 플러그인 밑(엔진 자리)에 앉는다: $ 호출은 { value } 로, 이벤트는 그 결과로 답한다.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Fake = {
  // 뒤에서 도는 일(fork·상태 새로 고침)은 clock.settle() 로 끝까지 기다린다.
  judgeReply: string
  forkReply: string
  completes: { model: string; system: string; prompt: string }[]
  forks: string[]
  submits: string[]
  commands: string[]
  fills: string[]
  /** 입력창 흐린 미리보기로 띄운 글. */
  suggests: string[]
  /** 가짜 입력창에 지금 들어 있는 글. */
  box: string
  toasts: string[]
  messages: { role: 'user' | 'assistant'; text: string; toolUses: never[] }[]
  contextPercent: number
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  /** 엔진(밑)이 마지막으로 받은 요청의 effort. */
  sent: unknown[]
  clock: MockClock
}

export function fakeEngine(on: On, over: Partial<Fake> = {}): Fake {
  const f: Fake = {
    judgeReply: '{"effort":"high","sure":0.9,"why":"여러 파일 리팩터"}',
    forkReply: '[{"label":"테스트 돌리기","prompt":"방금 고친 곳 테스트 돌려줘"},{"label":"커밋","prompt":"커밋해줘"}]',
    completes: [],
    forks: [],
    submits: [],
    commands: [],
    fills: [],
    suggests: [],
    box: '',
    toasts: [],
    messages: [],
    contextPercent: 7,
    limits: [
      { kind: 'five_hour', percentUsed: 42 },
      { kind: 'seven_day', percentUsed: 18 },
    ],
    sent: [],
    ...over,
    clock: mock.clock(on),
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('store.get', () => ({ value: null }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('session.cwd', () => ({ value: '/home/me/projects' }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('session.version', () => ({ value: { version: '2.1.314', base: '2.1.314' } }) as never)
  on('session.messages', () => ({ value: f.messages }) as never)
  on('session.usage', () =>
    ({
      value: {
        startedAt: 0,
        context: { tokens: f.contextPercent * 10_000, window: 1_000_000, percent: f.contextPercent },
        rateLimits: f.limits,
      },
    }) as never,
  )
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('model.complete', (_$, e) => {
    f.completes.push({ model: e.model, system: String(e.system ?? ''), prompt: String(e.prompt) })
    return { value: { isAnswered: true, text: f.judgeReply, usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  on('model.fork', (_$, e) => {
    f.forks.push(e.prompt)
    return { value: { isAnswered: true, text: f.forkReply, usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  on('command.list', () => ({ value: [] }) as never)
  on('prompt.suggest', (_$, e) => {
    f.suggests.push(e.text)
    return { isShown: true } as never
  })
  on('prompt.fill', (_$, e) => {
    f.fills.push(e.text)
    f.box = (e as { mode?: string }).mode === 'append' ? f.box + e.text : e.text
    return { isFilled: true, text: f.box, cursor: f.box.length } as never
  })
  on('prompt.read', () => ({ value: { text: f.box, cursor: f.box.length } }) as never)
  on('prompt.submit', (_$, e) => {
    f.submits.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('command.run', (_$, e) => {
    f.commands.push(e.command)
    return {} as never
  })
  on('ui.toast', (_$, e) => {
    f.toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [] }) as never)
  on('turn.step', async function* (_$, e) {
    f.sent.push(e.effort)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: e.model },
    } as never
  })
  return f
}

/** 사람이 입력창에서 보낸 질문. */
export async function submit($: Engine, text: string): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
}

export async function startHuman($: Engine, isInteractive = true): Promise<void> {
  await $.session.start({ cwd: '/home/me/projects', surface: isInteractive ? 'terminal' : null, isInteractive } as never)
}

/** turn.step 하나를 끝까지 읽고, 엔진(밑)이 받은 요청의 effort 를 돌려준다. */
export async function step(
  $: Engine,
  f: Fake,
  input: { model?: string; effort?: string; agentId?: string } = {},
): Promise<{ sentEffort: unknown }> {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: input.model ?? 'claude-opus-5-5',
    effort: input.effort ?? 'high',
    messageCount: 1,
    ...(input.agentId ? { agentId: input.agentId } : {}),
  } as never)
  for await (const _ of stream) {
    // 조각은 보지 않는다.
  }
  return { sentEffort: f.sent[f.sent.length - 1] }
}

/** 메인 턴 시작·끝을 엔진처럼 일으킨다. */
export async function turnStart($: Engine, turnId: string, text = ''): Promise<void> {
  await $.turn.start({ text, turnId } as never)
}
export async function turnEnd($: Engine, turnId: string, answer = '끝났습니다.'): Promise<void> {
  await $.turn.complete({ reason: 'answer', answer, durationMs: 10, isAborted: false, turnId } as never)
}
