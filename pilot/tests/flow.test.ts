// effort 자동·하위 에이전트·사람 없는 세션·다음 할 일·명령: 엔진을 흉내 내어 이벤트를 차례로 일으킨다.
import { expect, test } from 'claude-code/testing'

import { fakeEngine, startHuman, step, submit, turnEnd, turnStart } from './helpers'

test('질문을 보내면 Haiku 가 판정하고, 요청 하나의 effort 만 바뀐다', async ($, on) => {
  const f = fakeEngine(on)
  await startHuman($)
  await submit($, '이 폴더 전체를 리팩터해줘')
  expect(f.completes).toHaveLength(1)
  expect(f.completes[0]!.model).toBe('claude-haiku-5-5')
  const { sentEffort } = await step($, f, { effort: 'medium' })
  expect(sentEffort).toBe('high')
})

test('범위 밖 판정은 범위 끝으로 묶는다(균형 = 낮음~높음)', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"max","why":"아주 어려움"}' })
  await startHuman($)
  await submit($, '전체 구조를 다시 짜줘')
  expect((await step($, f, { effort: 'medium' })).sentEffort).toBe('high')
})

test('짧은 답은 판정 없이 직전 값을 그대로 쓴다', async ($, on) => {
  const f = fakeEngine(on, { messages: [{ role: 'assistant', text: '다 고쳤습니다.', toolUses: [] }] })
  await startHuman($)
  await submit($, '이 폴더 전체를 리팩터해줘')
  await submit($, 'ㄱㄱ')
  expect(f.completes).toHaveLength(1)
  expect((await step($, f, { effort: 'medium' })).sentEffort).toBe('high')
})

test('/effort 로 직접 바꾸면 자동을 끄고 앱 값을 그대로 보낸다', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧은 조회"}' })
  await startHuman($)
  await submit($, '날씨 알려줘')
  expect((await step($, f, { effort: 'high' })).sentEffort).toBe('low')
  // 사람이 앱 effort 를 high → xhigh 로 바꿈
  expect((await step($, f, { effort: 'xhigh' })).sentEffort).toBe('xhigh')
  expect((await step($, f, { effort: 'xhigh' })).sentEffort).toBe('xhigh')
})

test('Fable 처럼 캐시가 깨지는 모델에선 자동이 쉰다', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧음"}' })
  await startHuman($)
  await submit($, '날씨 알려줘')
  expect((await step($, f, { model: 'claude-fable-5-1', effort: 'high' })).sentEffort).toBe('high')
})

test('ultrathink 턴은 엔진이 올린 값을 그대로 둔다(자동도 안 꺼짐)', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧음"}' })
  await startHuman($)
  await submit($, '날씨 알려줘')
  await step($, f, { effort: 'high' })
  await submit($, 'ultrathink 이 버그 원인 찾아줘')
  expect((await step($, f, { effort: 'xhigh' })).sentEffort).toBe('xhigh')
  expect(f.completes).toHaveLength(1)
  await submit($, '고마워 이제 정리해줘')
  expect((await step($, f, { effort: 'high' })).sentEffort).toBe('low')
})

test('질문에 effort 를 적으면 판정 없이 그 값', async ($, on) => {
  const f = fakeEngine(on)
  await startHuman($)
  await submit($, 'effort 최대로 이 설계 검토해줘')
  expect(f.completes).toHaveLength(0)
  expect((await step($, f, { effort: 'medium' })).sentEffort).toBe('max')
})

test('하위 에이전트는 메인 질문 값을 따르되 중간 아래로는 안 내려간다', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧음"}' })
  await startHuman($)
  await submit($, '날씨 알려줘')
  expect((await step($, f, { agentId: 'a1', effort: 'high' })).sentEffort).toBe('medium')
})

test('사람이 없는 세션(claude -p)에선 판정도 변경도 하지 않는다', async ($, on) => {
  const f = fakeEngine(on)
  await startHuman($, false)
  await submit($, '이 폴더 전체를 리팩터해줘')
  expect(f.completes).toHaveLength(0)
  expect((await step($, f, { effort: 'medium' })).sentEffort).toBe('medium')
})

test('설정에서 자동을 끄면 판정하지 않는다', { options: { autoEffort: false } }, async ($, on) => {
  const f = fakeEngine(on)
  await startHuman($)
  await submit($, '이 폴더 전체를 리팩터해줘')
  expect(f.completes).toHaveLength(0)
  expect((await step($, f, { effort: 'medium' })).sentEffort).toBe('medium')
})

test('답이 끝나면 다음 할 일을 사용자 말투로 받고, 1번은 Tab 미리보기로 띄운다', async ($, on) => {
  const f = fakeEngine(on)
  await startHuman($)
  await $.turn.complete({ reason: 'answer', answer: '다 고쳤습니다. '.repeat(10), durationMs: 1000, isAborted: false, turnId: 't9' } as never)
  // fork 는 기다리지 않고 뒤에서 돈다.
  await f.clock.settle()
  expect(f.forks[0]).toContain('speech level')
  expect(f.forks[0]).toContain('not replies you speak')
  expect(f.forks[0]).not.toContain('polite,')
  expect(f.suggests).toEqual(['방금 고친 곳 테스트 돌려줘'])
})

test('/pilot 상태 는 앱 값과 실제로 보낸 값을 보여 준다', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧은 조회"}' })
  await startHuman($)
  await submit($, '날씨 알려줘')
  await step($, f, { effort: 'high' })
  const r = await $.command.run({ command: 'pilot', args: '상태' } as never)
  const text = String((r as { text?: unknown }).text)
  expect(text).toContain('앱 설정 high → 실제로 보냄 low')
  expect(text).toContain('pilot 이 바꿈')
})

test('/pilot 인계: fork 로 메모를 쓰고, 대화를 비운 뒤 새 대화 첫 메시지로 넣고 기다린다', async ($, on) => {
  const f = fakeEngine(on, { forkReply: '- 목표: 막대 만들기\n- 다음 할 일: 테스트' })
  await startHuman($)
  await $.command.run({ command: 'pilot', args: '인계' } as never)
  await f.clock.advance(1000)
  await f.clock.settle()
  expect(f.forks.some(p => p.includes('인계 메모를 써라'))).toBe(true)
  expect(f.commands).toContain('clear')
  const last = f.submits[f.submits.length - 1] ?? ''
  expect(last).toContain('지난 대화에서 넘어온 인계 메모')
  expect(last).toContain('막대 만들기')
  expect(last).toContain('내 말을 기다려')
})

test('인계한 다음 = 복사만 이면 대화를 비우지 않는다', { options: { handoffAfter: '복사만' } }, async ($, on) => {
  const f = fakeEngine(on, { forkReply: '- 목표: 막대 만들기' })
  on('ui.copy', () => ({ value: { isCopied: true } }) as never)
  await startHuman($)
  await $.command.run({ command: 'pilot', args: '인계' } as never)
  await f.clock.advance(1000)
  await f.clock.settle()
  expect(f.commands).not.toContain('clear')
})

test('/pilot 절약: 켜면 자동 effort 가 중간을 넘지 않는다', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"high","why":"큰 작업"}' })
  await startHuman($)
  const r = await $.command.run({ command: 'pilot', args: '절약' } as never)
  expect(String((r as { text?: unknown }).text)).toContain('절약 모드를 켰어요')
  await submit($, '이 폴더 전체를 리팩터해줘')
  expect((await step($, f, { effort: 'high' })).sentEffort).toBe('medium')
})

test('압축 모델을 Sonnet 으로 고르면 Sonnet 요약으로 압축한다', { options: { compactModel: 'Sonnet' } }, async ($, on) => {
  const summary = `1. 요청: 막대 만들기. ${'자세한 내용. '.repeat(40)}`
  const f = fakeEngine(on, { judgeReply: summary })
  await startHuman($)
  const r = await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: '막대 만들어줘', toolUses: [] }] } as never)
  const text = String((r as { messages?: { text: string }[] }).messages?.[0]?.text ?? '')
  expect(text).toContain('막대 만들기')
  expect(f.completes.some(c => c.system.includes('You compact a conversation') && c.model === 'claude-sonnet-5-5')).toBe(true)
  expect(text).toContain('Sonnet 5.5')
})

test('턴이 도는 중엔 인계를 시작하지 않는다', async ($, on) => {
  const f = fakeEngine(on)
  await startHuman($)
  await turnStart($, 't1', '긴 작업 해줘')
  await $.command.run({ command: 'pilot', args: '인계' } as never)
  await f.clock.advance(1000)
  await f.clock.settle()
  expect(f.forks).toHaveLength(0)
  expect(f.commands).not.toContain('clear')
})

test('턴 중에 보낸 질문의 판정은 지금 턴을 흔들지 않고 턴이 끝나면 적용된다', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧음"}' })
  await startHuman($)
  await submit($, '날씨 알려줘')
  await turnStart($, 't1', '날씨 알려줘')
  expect((await step($, f, { effort: 'medium' })).sentEffort).toBe('low')
  f.judgeReply = '{"effort":"high","why":"큰 작업"}'
  await submit($, '그리고 이 폴더 전체를 리팩터해줘')
  expect((await step($, f, { effort: 'medium' })).sentEffort).toBe('low')
  await turnEnd($, 't1')
  expect((await step($, f, { effort: 'medium' })).sentEffort).toBe('high')
})

test('모델을 바꿔 앱 기본 effort 가 달라져도 사람이 바꾼 걸로 보지 않는다', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧음"}' })
  await startHuman($)
  await submit($, '날씨 알려줘')
  expect((await step($, f, { model: 'claude-opus-5-5', effort: 'medium' })).sentEffort).toBe('low')
  expect((await step($, f, { model: 'claude-sonnet-5-5', effort: 'high' })).sentEffort).toBe('low')
})

test('꼼꼼한 인계는 자기가 보낸 턴의 답만 메모로 받는다', async ($, on) => {
  const f = fakeEngine(on)
  await startHuman($)
  await $.command.run({ command: 'pilot', args: '인계 꼼꼼' } as never)
  await f.clock.advance(1000)
  const sent = f.submits[f.submits.length - 1] ?? ''
  expect(sent).toContain('HANDOFF.md')
  // 다른 턴이 먼저 끝나도 메모로 잡지 않는다.
  await turnStart($, 'other', '딴 질문')
  await turnEnd($, 'other', '딴 답')
  await f.clock.advance(1000)
  expect(f.commands).not.toContain('clear')
  // 엔진은 플러그인이 보낸 글 앞에 안내를 붙여 턴을 시작한다.
  await turnStart($, 'mine', `The pilot plugin sent a message:\n${sent}`)
  await turnEnd($, 'mine', '- 목표: 막대 만들기')
  await f.clock.advance(1000)
  await f.clock.settle()
  expect(f.commands).toContain('clear')
  expect(f.submits[f.submits.length - 1]).toContain('막대 만들기')
})

test('인계 메모 모델을 Opus 로 고르면 fork 대신 Opus 가 대화 글을 읽고 쓴다', { options: { handoffModel: 'Opus' } }, async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '- 목표: Opus 가 쓴 메모', messages: [{ role: 'user', text: '막대 만들어줘', toolUses: [] }] })
  await startHuman($)
  await $.command.run({ command: 'pilot', args: '인계' } as never)
  await f.clock.advance(1000)
  await f.clock.settle()
  expect(f.forks).toHaveLength(0)
  expect(f.completes.some(c => c.model === 'claude-opus-5-5')).toBe(true)
  expect(f.submits[f.submits.length - 1]).toContain('Opus 가 쓴 메모')
})
