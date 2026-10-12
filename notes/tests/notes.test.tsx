import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// 노트 파일을 메모리에 둔다. 쓴 횟수를 돌려준다.
function fakeFiles(on: On) {
  const files = new Map<string, string>()
  const writes: string[] = []
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    writes.push(e.path)
    return { value: undefined }
  })
  return { files, writes }
}

const PANE = { title: 'notes', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 200 } } as const

test('에이전트가 만든 탭이 옆 창에 보이고, 체크하면 취소선이 그어진다', async ($, on) => {
  const { writes } = fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)

  const wrote = await $.tool.call({
    tool: 'mcp__notes__notes_write',
    tab: '대시보드 쿼리',
    done_when: 'QA 합계 일치',
    items: ['원인 쿼리 찾기', '수정안 작성', 'QA 반영'],
  } as never)
  expect(String(wrote.result)).toContain('#1 [ ] 원인 쿼리 찾기')

  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '대시보드 쿼리', items: [1] } as never)
  expect(writes.length).toBe(2)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'notes', surface, component: 'Pane', requestId: 'notes', props: PANE })
    expect((await ui.find({ type: 'Text', text: /종료 조건: QA 합계 일치/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /원인 쿼리 찾기/ }))?.props.strikethrough).toBe(true)
    expect((await ui.find({ type: 'Text', text: /수정안 작성/ }))?.props.strikethrough).toBe(false)
    if (surface === 'desktop') continue

    await ui.press({ key: 'chk-1' })
    expect((await ui.find({ type: 'Text', text: /수정안 작성/ }))?.props.strikethrough).toBe(true)
  }

  const read = await $.tool.call({ tool: 'mcp__notes__notes_read' } as never)
  expect(String(read.result)).toContain('(2/3)')
})

test('탭이 여러 개면 탭 버튼으로 전환된다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '대시보드 쿼리', items: ['A'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '크론 로그', items: ['B'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.findAll({ type: 'Button', text: /^(▶ )?(대시보드 쿼리|크론 로그)$/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /B$/ })).toBeDefined()

  await ui.press({ key: 'tab-대시보드 쿼리' })
  expect(await ui.find({ type: 'Text', text: /^A$/ })).toBeDefined()
})

test('다른 세션이 파일에 추가한 탭을 덮어쓰지 않는다', async ($, on) => {
  const { files } = fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '내 작업', items: ['A'] } as never)

  const [path, text] = [...files.entries()][0]!
  const other = JSON.parse(text) as { tabs: unknown[] }
  other.tabs.push({ title: '다른 세션 작업', items: [{ text: 'X', isDone: false }], updatedAt: '' })
  files.set(path, JSON.stringify(other))

  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '내 작업', items: [1] } as never)
  const saved = JSON.parse(files.get(path)!) as { tabs: { title: string }[] }
  expect(saved.tabs.map(t => t.title)).toEqual(['내 작업', '다른 세션 작업'])
})

test('시스템 프롬프트 끝에 notes 사용 규칙이 붙는다', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  expect(sections.map(s => s.id)).toEqual(['intro', 'notes:guide'])
  expect(sections[1]?.text).toContain('notes_check')
})

test('편집은 [저장] 해야 반영되고, 비운 단계는 빠지고, 새 단계가 더해진다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '편집 시험', items: ['가', '나', '다'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  await ui.press({ key: 'edit' })
  await ui.input({ key: 'edit-item-0', text: '가 고침', kind: 'change' })
  await ui.input({ key: 'edit-item-1', text: '', kind: 'change' })
  await ui.input({ key: 'edit-add', text: '라' })
  await ui.input({ key: 'edit-doneWhen', text: '모두 체크', kind: 'change' })
  await ui.input({ key: 'edit-title', text: '편집 끝난 탭', kind: 'change' })

  const before = await $.tool.call({ tool: 'mcp__notes__notes_read', tab: '편집 시험' } as never)
  expect(String(before.result)).toContain('#1 [ ] 가')

  await ui.press({ key: 'edit-save' })
  const read = await $.tool.call({ tool: 'mcp__notes__notes_read', tab: '편집 끝난 탭' } as never)
  expect(String(read.result)).toBe(['# 편집 끝난 탭 (0/3)', '종료 조건: 모두 체크', '#1 [ ] 가 고침', '#2 [ ] 다', '#3 [ ] 라'].join('\n'))
})

test('[취소]하면 고친 내용이 버려진다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '취소 시험', items: ['가'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  await ui.press({ key: 'edit' })
  await ui.input({ key: 'edit-item-0', text: '바뀜', kind: 'change' })
  await ui.press({ key: 'edit-cancel' })

  expect(await ui.find({ type: 'Text', text: /^가$/ })).toBeDefined()
  const read = await $.tool.call({ tool: 'mcp__notes__notes_read', tab: '취소 시험' } as never)
  expect(String(read.result)).toContain('#1 [ ] 가')
})

test('되돌리기는 체크·편집·탭 지우기를 하나씩 되돌린다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '되돌리기', items: ['가', '나'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  await ui.press({ key: 'chk-0' })
  await ui.press({ key: 'remove' })
  expect(await ui.find({ type: 'Text', text: /아직 노트가 없습니다/ })).toBeDefined()

  await ui.press({ key: 'undo' })
  expect((await ui.find({ type: 'Text', text: /^가$/ }))?.props.strikethrough).toBe(true)

  await ui.press({ key: 'undo' })
  expect((await ui.find({ type: 'Text', text: /^가$/ }))?.props.strikethrough).toBe(false)

  await ui.press({ key: 'undo' })
  expect(await ui.find({ type: 'Text', text: /아직 노트가 없습니다/ })).toBeDefined()
  expect(await ui.find({ key: 'undo' })).toBeUndefined()
})

test('문구 칸에서 Enter 해도 저장되지 않고, [저장] 을 눌러야 반영된다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: 'Enter 시험', items: ['가', '나'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  await ui.press({ key: 'edit' })
  await ui.input({ key: 'edit-goal', text: '목표 넣음', kind: 'change' })
  await ui.input({ key: 'edit-item-1', text: '나 고침' })

  expect(await ui.find({ key: 'edit-item-1' })).toBeDefined()
  const before = await $.tool.call({ tool: 'mcp__notes__notes_read', tab: 'Enter 시험' } as never)
  expect(String(before.result)).toBe(['# Enter 시험 (0/2)', '#1 [ ] 가', '#2 [ ] 나'].join('\n'))

  await ui.press({ key: 'edit-save' })
  const read = await $.tool.call({ tool: 'mcp__notes__notes_read', tab: 'Enter 시험' } as never)
  expect(String(read.result)).toBe(['# Enter 시험 (0/2)', '목표: 목표 넣음', '#1 [ ] 가', '#2 [ ] 나 고침'].join('\n'))
})

test('창은 번호를 붙이지 않고 에이전트가 쓴 문구 그대로 보여 준다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '번호 시험', items: ['[결정] 범위 확인', '1. 첫 단계', '1-1. 하위 단계'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ type: 'Text', text: /^\[결정\] 범위 확인$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1-1\. 하위 단계$/ })).toBeDefined()

  const read = await $.tool.call({ tool: 'mcp__notes__notes_read', tab: '번호 시험' } as never)
  expect(String(read.result)).toContain('#2 [ ] 1. 첫 단계')
})

test('처음에는 [▲ 위로] 없이 탭 줄 다음에 본문이 처음부터 나온다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  const items = Array.from({ length: 20 }, (_, n) => `단계 ${n + 1}`)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '긴 탭', items } as never)

  const small = { ...PANE, scroll: { offset: 0, bodyRows: 10 } }
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: small as never })
  expect(await ui.find({ key: 'tab-긴 탭' })).toBeDefined()
  expect(await ui.find({ key: 'scroll-up' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^긴 탭 \(0\/20\)$/ })).toBeDefined()
  expect(await ui.find({ key: 'remove' })).toBeDefined()
})

test('줄의 글자를 눌러도 체크가 바뀐다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '줄 누르기', items: ['가', '나'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect((await ui.find({ key: 'chk-1' }))?.type).toBe('Button')
  expect(await ui.find({ key: 'chk-1', text: /나/ })).toBeDefined()
  await ui.press({ key: 'chk-1' })
  expect((await ui.find({ type: 'Text', text: /^나$/ }))?.props.strikethrough).toBe(true)
})
