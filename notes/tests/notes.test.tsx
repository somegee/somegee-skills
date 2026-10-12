import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// 노트 파일을 메모리에 둔다. 쓴 횟수를 돌려준다. 경로는 / 로 맞춰 둔다(엔진이 \ 로 바꿔 넘기기도 한다).
function fakeFiles(on: On) {
  const files = new Map<string, string>()
  const writes: string[] = []
  const reads: string[] = []
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('fs.read', (_$, e) => {
    const text = files.get(norm(e.path))
    reads.push(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(norm(e.path), e.text)
    writes.push(norm(e.path))
    return { value: undefined }
  })
  return { files, writes, reads }
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
  expect(await ui.find({ type: 'Text', text: /^- 첫 줄$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- 둘째 줄$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Button', text: /첫 줄/ })).toHaveLength(0)
})

test('창에 다 안 들어가면 본문을 창 높이만큼만 보이고, [▼ 아래로] 는 줄 단위로 내린다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  const items = Array.from({ length: 20 }, (_, n) => `단계 ${n + 1}`)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '긴 탭', items } as never)

  const small = { ...PANE, scroll: { offset: 0, bodyRows: 15 } }
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: small as never })
  // 탭 줄 3·버튼 줄 4(되돌리기·닫기가 붙어 두 줄로 접힘)·여유 1 → 본문 자리 7줄, 위·아래 표시 2줄을 빼면 창 5줄.
  // 본문 24줄(제목 1 + 세션 1 + 할 일 2 + 단계 20).
  expect((await ui.find({ key: 'viewport' }))?.props.height).toBe(5)
  expect(await ui.find({ key: 'remove' })).toBeDefined()
  expect((await ui.find({ key: 'viewport-body' }))?.props.marginTop).toBe(-0)
  expect(await ui.find({ key: 'scroll-up' })).toBeUndefined()
  expect((await ui.find({ key: 'scroll-down' }))?.text).toContain('▼ 아래로 (20줄)')

  await ui.press({ key: 'scroll-down' })
  expect((await ui.find({ key: 'viewport-body' }))?.props.marginTop).toBe(-4)
  expect((await ui.find({ key: 'scroll-up' }))?.text).toContain('▲ 위로 (4줄)')
  expect((await ui.find({ key: 'scroll-down' }))?.text).toContain('▼ 아래로 (16줄)')
})

test('창에 다 들어가면 위·아래 표시도 창 자리도 없다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '짧은 탭2', items: ['가'] } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ key: 'viewport' })).toBeUndefined()
  expect(await ui.find({ key: 'scroll-up' })).toBeUndefined()
})

test('되돌린 것은 [앞으로] 로 다시 하고, 새로 고치면 [앞으로] 가 사라진다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '앞으로', items: ['가', '나'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  await ui.press({ key: 'chk-0' })
  expect(await ui.find({ key: 'redo' })).toBeUndefined()

  await ui.press({ key: 'undo' })
  expect((await ui.find({ type: 'Text', text: /^가$/ }))?.props.strikethrough).toBe(false)
  expect((await ui.find({ key: 'redo' }))?.text).toContain('↷ 앞으로')

  await ui.press({ key: 'redo' })
  expect((await ui.find({ type: 'Text', text: /^가$/ }))?.props.strikethrough).toBe(true)
  expect(await ui.find({ key: 'redo' })).toBeUndefined()

  await ui.press({ key: 'undo' })
  await ui.press({ key: 'chk-1' })
  expect(await ui.find({ key: 'redo' })).toBeUndefined()
})

test('데스크톱에서는 체크 표시가 버튼 이름에 들어가고, 스크롤 창 없이 버튼 줄까지 이어 그린다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  const items = Array.from({ length: 30 }, (_, n) => `단계 ${n + 1}`)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '데스크톱', items } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '데스크톱', items: [1] } as never)

  const small = { ...PANE, placement: 'dock', scroll: { offset: 0, bodyRows: 12 } }
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'desktop', component: 'Pane', requestId: 'notes', props: small as never })
  expect((await ui.find({ key: 'chk-0' }))?.props.label).toBe('☑ 단계 1')
  expect((await ui.find({ key: 'chk-1' }))?.props.label).toBe('▶ 단계 2')
  expect((await ui.find({ key: 'chk-2' }))?.props.label).toBe('☐ 단계 3')
  expect(await ui.find({ key: 'viewport' })).toBeUndefined()
  expect(await ui.find({ key: 'remove' })).toBeDefined()
})

test('메모가 이미 - 로 시작하면 - 를 겹쳐 붙이지 않는다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '메모 머리표', items: ['가'], memo: '- 이미 있음\n없음' } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ type: 'Text', text: /^- 이미 있음$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- 없음$/ })).toBeDefined()
})

test('막힘·대기 사유와 풀린 뒤 처리 내역이 그 단계 바로 아래에 보이고, 결과물은 따로 모인다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '막힘', items: ['배포', '확인'], add_results: ['커밋 abc123'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '막힘', item: 1, status: 'blocked', note: '권한 없음' } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '막힘', item: 2, status: 'waiting', note: '지윤님 확인' } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ type: 'Text', text: /⛔ 막힘: 권한 없음/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⏳ 대기: 지윤님 확인/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^결과물$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- 커밋 abc123$/ })).toBeDefined()

  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '막힘', item: 1, status: 'clear', note: '지윤님이 권한 부여' } as never)
  expect(await ui.find({ type: 'Text', text: /⛔ 막힘/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /↳ 해결: 지윤님이 권한 부여/ })).toBeDefined()

  // 같은 문구로 단계를 다시 써도 막힘·처리 내역은 이어진다.
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '막힘', items: ['배포', '확인', '마무리'] } as never)
  expect(await ui.find({ type: 'Text', text: /⏳ 대기: 지윤님 확인/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- 커밋 abc123$/ })).toBeDefined()
})

test('지금 하는 단계(안 끝난 첫 단계)는 ▶ 와 고정 배경색으로, 제목 아래엔 세션과 갱신 시각이 보이고, [닫기] 가 있다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '현재 단계', items: ['가', '나', '다'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '현재 단계', items: [1] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect((await ui.find({ key: 'chk-1' }))?.props.label).toBe('▶ 나')
  expect((await ui.find({ type: 'Text', text: /^나$/ }))?.props.backgroundColor).toBeDefined()
  expect((await ui.find({ key: 'chk-2' }))?.props.label).toBe('☐ 다')
  expect(await ui.find({ type: 'Text', text: /· (방금|[0-9]+분 전) 갱신$/ })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeDefined()
})

test('결과물에 주소가 있으면 링크로 그린다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '링크', items: ['가'], results: ['PR https://github.com/a/b/pull/1 (리뷰 대기)', '커밋 abc'] } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  const links = await ui.findAll({ type: 'Link' })
  expect(links).toHaveLength(1)
  expect(links[0]?.props.href).toBe('https://github.com/a/b/pull/1')
  expect(await ui.find({ type: 'Text', text: /^- 커밋 abc$/ })).toBeDefined()
})

test('세션 이름은 대화 기록의 마지막 /rename 이름을 쓰고, 이름을 바꾸면 다음 프롬프트에 반영된다', async ($, on) => {
  const { files, reads } = fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  on('classic.UserPromptSubmit', () => ({}))
  // 엔진이 경로를 절대 경로로 바꿔 읽으므로 처음부터 절대 경로로 둔다.
  const TP = 'C:/notes-test/T.jsonl'
  files.set(TP, '{"type":"ai-title","aiTitle":"자동 제목"}\n')
  await $.classic.UserPromptSubmit({ transcript_path: TP, prompt: 'a' } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '이름', items: ['가'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(reads).toContain(TP)
  expect(await ui.find({ type: 'Text', text: /^자동 제목 · / })).toBeDefined()

  files.set(TP, '{"type":"ai-title","aiTitle":"자동 제목"}\n{"type":"custom-title","customTitle":"mod"}\n')
  await $.classic.UserPromptSubmit({ transcript_path: TP, prompt: 'b' } as never)
  expect(await ui.find({ type: 'Text', text: /^mod · / })).toBeDefined()
})
