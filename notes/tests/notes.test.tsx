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
    expect(await ui.find({ type: 'Text', text: /^종료 조건$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^QA 합계 일치$/ })).toBeDefined()
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

test('되돌리기는 체크·탭 지우기를 하나씩 되돌린다', async ($, on) => {
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
  expect(await ui.find({ key: 'edit' })).toBeUndefined()
})

test('창에 다 안 들어가면 들어가는 만큼만 그리고 [▼ 아래로] 를 두며, 누르면 내려가고 [▲ 위로] 가 생긴다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  const items = Array.from({ length: 20 }, (_, n) => `단계 ${n + 1}`)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '긴 탭', items } as never)

  const small = { ...PANE, scroll: { offset: 0, bodyRows: 12 } }
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: small as never })
  // 탭 줄 3 + 제목 1 + 할 일 2 + 단계 4 = 10, 남은 2줄은 [▼ 아래로] 와 여유 줄.
  expect(await ui.find({ type: 'Text', text: /^단계 4$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^단계 5$/ })).toBeUndefined()
  expect(await ui.find({ key: 'remove' })).toBeUndefined()
  const down = await ui.find({ key: 'scroll-down' })
  expect(down?.text).toContain('▼ 아래로 (17)')

  await ui.press({ key: 'scroll-down' })
  expect(await ui.find({ key: 'scroll-up' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^단계 1$/ })).toBeUndefined()
})

test('창에 다 들어가면 [▼ 아래로] 가 없다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '짧은 탭', items: ['가', '나'] } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ key: 'scroll-down' })).toBeUndefined()
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

test('목표·종료 조건·할 일·메모가 구역 제목으로 나뉘고, 메모는 체크 칸 없이 줄마다 보인다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '구역 시험', goal: '목표 문장', done_when: '끝 조건', items: ['가'], memo: '첫 줄\n둘째 줄' } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  for (const label of ['목표', '종료 조건', '할 일', '메모']) {
    expect(await ui.find({ type: 'Text', text: new RegExp(`^${label}$`) })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /^첫 줄$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^둘째 줄$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Button', text: /첫 줄/ })).toHaveLength(0)
})

test('다음 묶음이 통째로 안 들어가도 남는 줄만큼은 잘라서 보여 준다 (긴 메모)', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  const memo = Array.from({ length: 30 }, (_, n) => `메모 ${n + 1}`).join('\n')
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '긴 메모', items: ['가'], memo } as never)

  const small = { ...PANE, scroll: { offset: 0, bodyRows: 20 } }
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: small as never })
  expect(await ui.find({ type: 'Text', text: /^메모$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^메모 1$/ })).toBeDefined()
  expect(await ui.find({ key: 'partial' })).toBeDefined()
  expect((await ui.find({ key: 'scroll-down' }))?.text).toContain('▼ 아래로 (2)')
})
