// 입력창 위 막대: 상태줄 글자, 버튼, 좁은 폭, 설정 띠.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fakeEngine, startHuman, step, submit } from './helpers'

const BAND = (bodyColumns: number) =>
  ({
    plugin: 'pilot',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  }) as const

async function ready($: Engine, on: On) {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧은 조회"}' })
  // 엔진(밑)은 아무것도 그리지 않는다.
  on('ui.render', ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  await startHuman($)
  await submit($, '날씨 알려줘')
  await step($, f, { effort: 'high' })
  // 상태줄 새로 고침은 뒤에서 돈다.
  await f.clock.settle()
}

test('상태줄에 폴더·브랜치·모델과 실제 effort·컨텍스트·버전이 보이고, 캐시·한도는 기본으로 숨는다', async ($, on) => {
  await ready($, on)
  const ui = await $.ui.mount({ ...BAND(200), surface: 'terminal' } as never)
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
  expect(all).toContain('projects')
  expect(all).toContain('main')
  expect(all).toContain('Opus 5.5')
  expect(all).toContain('low 자동')
  expect(all).toContain('70k/1000k')
  expect(all).not.toContain('70k/1000k 7%')
  expect(all).not.toContain('5시간 42%')
  expect(all).not.toContain('캐시')
  expect(all).toContain('2.1.314')
  expect(all).toContain('Haiku: 짧은 조회')
  await ui.unmount()
})

test('버튼: 자동 켜짐 → 누르면 꺼짐', async ($, on) => {
  await ready($, on)
  const ui = await $.ui.mount({ ...BAND(200), surface: 'terminal' } as never)
  expect((await ui.find({ type: 'Button', key: 'auto' }))?.text).toContain('자동 켜짐')
  // 강조는 바탕색이 아니라 굵은 글씨로.
  expect((await ui.find({ type: 'Button', key: 'auto' }))?.props.variant).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '자동 켜짐' }))?.props.bold).toBe(true)
  await ui.press({ key: 'auto' } as never)
  expect((await ui.find({ type: 'Button', key: 'auto' }))?.text).toContain('자동 꺼짐')
  await ui.unmount()
})

test('notes 처럼 둥근 테두리 안에 그리고, 설정 버튼은 없다(설정은 /config)', async ($, on) => {
  await ready($, on)
  const ui = await $.ui.mount({ ...BAND(200), surface: 'terminal' } as never)
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.borderStyle === 'round')).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'settings' })).toBeFalsy()
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => /^─{10,}$/.test(t))).toBe(true)
  await ui.unmount()
})

test('좁은 폭(60칸)에서도 그려지고 상태줄이 여러 줄로 나뉜다', async ($, on) => {
  await ready($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND(60), surface } as never)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
    expect(texts).toContain('Opus 5.5')
    await ui.unmount()
  }
})

test('인계 버튼을 누르면 빠르게·꼼꼼히 띠가 뜬다', async ($, on) => {
  await ready($, on)
  const ui = await $.ui.mount({ ...BAND(200), surface: 'terminal' } as never)
  await ui.press({ key: 'handoff' } as never)
  expect((await ui.find({ type: 'Button', key: 'handoff-quick' }))?.text).toContain('빠르게')
  expect((await ui.find({ type: 'Button', key: 'handoff-full' }))?.props.label).toBe('꼼꼼히')
  await ui.unmount()
})

test('한도 80% 를 넘으면 경고와 [절약 켜기] 가 뜨고, 누르면 절약 중으로 바뀐다', async ($, on) => {
  const f = fakeEngine(on, { judgeReply: '{"effort":"low","why":"짧은 조회"}', limits: [{ kind: 'five_hour', percentUsed: 86 }] })
  on('ui.render', ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  await startHuman($)
  await submit($, '날씨 알려줘')
  await step($, f, { effort: 'high' })
  await f.clock.settle()
  const ui = await $.ui.mount({ ...BAND(200), surface: 'terminal' } as never)
  const before = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
  expect(before).toContain('5시간 한도 86%')
  await ui.press({ key: 'save' } as never)
  const after = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
  expect(after).toContain('절약 중')
  await ui.unmount()
})

test('설정에서 캐시·한도 표시를 켜면 상태줄에 나온다', { options: { showCache: true, showLimits: true } }, async ($, on) => {
  await ready($, on)
  const ui = await $.ui.mount({ ...BAND(200), surface: 'terminal' } as never)
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')
  expect(all).toContain('5시간 42%')
  await ui.unmount()
})

async function withSuggestions($: Engine, on: On) {
  const f = fakeEngine(on)
  on('ui.render', ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  await startHuman($)
  await $.turn.complete({ reason: 'answer', answer: '다 고쳤습니다. '.repeat(10), durationMs: 10, isAborted: false, turnId: 't1' } as never)
  await f.clock.settle()
  return f
}

test('다음 할 일: 번호를 바꾸면 초안이 바뀌고, 같은 번호를 다시 누르면 비워지며 목록은 남는다', async ($, on) => {
  const f = await withSuggestions($, on)
  const ui = await $.ui.mount({ ...BAND(200), surface: 'terminal' } as never)
  // 클릭으로만: 숫자 단축키가 없어야 빈 입력창에 숫자로 시작하는 글을 쳐도 눌리지 않는다.
  for (const key of ['next-0', 'next-1', 'next-dismiss']) expect((await ui.find({ type: 'Button', key }))?.props.hotkey).toBeUndefined()
  await ui.press({ key: 'next-0' } as never)
  expect(f.box).toBe('방금 고친 곳 테스트 돌려줘')
  expect((await ui.find({ type: 'Button', key: 'next-0' }))?.text).toContain('▶테스트 돌리기')
  await ui.press({ key: 'next-1' } as never)
  expect(f.box).toBe('커밋해줘')
  expect((await ui.find({ type: 'Button', key: 'next-0' }))?.text).not.toContain('▶')
  await ui.press({ key: 'next-1' } as never)
  expect(f.box).toBe('')
  expect(await ui.find({ type: 'Button', key: 'next-0' })).toBeTruthy()
  await ui.unmount()
})

test('다음 할 일: 입력창에 직접 쓴 글은 덮어쓰지 않고 뒤에 붙이고, 비울 때도 건드리지 않는다', async ($, on) => {
  const f = await withSuggestions($, on)
  f.box = '내가 쓴 글'
  const ui = await $.ui.mount({ ...BAND(200), surface: 'terminal' } as never)
  await ui.press({ key: 'next-1' } as never)
  expect(f.box).toBe('내가 쓴 글 커밋해줘')
  await ui.press({ key: 'next-1' } as never)
  expect(f.box).toBe('내가 쓴 글 커밋해줘')
  await ui.unmount()
})
