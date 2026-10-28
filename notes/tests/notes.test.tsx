import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// 노트 파일을 메모리에 둔다. 쓴 횟수를 돌려준다. 경로는 / 로 맞춰 둔다(엔진이 \ 로 바꿔 넘기기도 한다).
function fakeFiles(on: On) {
  const files = new Map<string, string>()
  const writes: string[] = []
  const reads: string[] = []
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('fs.read', (_$, e) => {
    // 키를 파일 이름 끝부분('/w.json')으로 넣어 두어도 찾는다(모드 폴더 경로를 몰라도 되게).
    const text = files.get(norm(e.path)) ?? [...files].find(([k]) => k.startsWith('/') && norm(e.path).endsWith(k))?.[1]
    reads.push(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(norm(e.path), e.text)
    writes.push(norm(e.path))
    return { value: undefined }
  })
  on('session.root', () => ({ value: '/w' }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  return { files, writes, reads }
}

const PANE = { title: 'notes', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 200 } } as const

// 사람이 있는 세션을 시작하고, 등록된 도구 이름 → 설명을 돌려준다. 시계는 넘기면 쓰는 쪽(mock.clock)이 맡는다.
async function startSession($: Engine, on: On, options: { isInteractive?: boolean; hasClock?: boolean } = {}) {
  const tools = new Map<string, string>()
  on('tool.register', (_$, e) => {
    tools.set(e.name, e.description)
    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  if (options.hasClock !== true) on('clock.every', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  const isInteractive = options.isInteractive !== false
  await $.session.start({ cwd: '/w', surface: isInteractive ? 'terminal' : null, isInteractive } as never)
  return tools
}
// 모델에게는 도구 설명의 앞 4,096자만 간다(Claude Code 가 자른다).
const TOOL_DESCRIPTION_MAX = 4096

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
    expect(await ui.find({ type: 'Text', text: /^▾ 종료 조건$/ })).toBeDefined()
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /^QA 합계 일치$/ })).toBeDefined()
    else expect((await ui.find({ key: 'doneWhen-md' }))?.props.text).toBe('QA 합계 일치')
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
  expect(await ui.findAll({ type: 'Button', text: /^(\[ )?(▶ )?(대시보드 쿼리|크론 로그)( \])?$/ })).toHaveLength(2)
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

// 관리형 설정 PC 에서는 보안 모듈이 prompt.compose 훅을 건너뛰므로 규칙은 도구 설명으로 들어간다.
test('notes 사용 규칙은 notes_write 도구 설명에 붙고, 시스템 프롬프트에는 넣지 않는다(두 번 들어가지 않게)', async ($, on) => {
  fakeFiles(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  const tools = await startSession($, on)
  const description = tools.get('notes_write') ?? ''
  expect(description).toContain('첫 작업(도구 호출) 전에 notes_write 로 탭부터 만든다')
  expect(description).toContain('notes_status')
  expect(description.length).toBeLessThanOrEqual(TOOL_DESCRIPTION_MAX)
  // 사용 규칙은 notes_write 한 곳에만.
  expect([...tools].filter(([, d]) => d.includes('## 쓰는 법')).map(([n]) => n)).toEqual(['notes_write'])

  for (const surfaces of [['terminal'], []] as const) {
    const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces, tools: [], outputStyle: null, traits: [] })
    expect(sections.map(s => s.id)).toEqual(['intro'])
  }
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
    expect(await ui.find({ type: 'Text', text: new RegExp(`^▾ ${label}$`) })).toBeDefined()
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
  // 탭 줄 3·버튼 줄 2(버튼 한 줄 + 가로줄) → 본문 자리 10줄, 위·아래 표시 2줄을 빼면 창 8줄.
  // 본문 24줄(제목 1 + 세션 1 + 할 일 2 + 단계 20).
  expect((await ui.find({ key: 'viewport' }))?.props.height).toBe(8)
  expect(await ui.find({ key: 'remove' })).toBeDefined()
  expect((await ui.find({ key: 'viewport-body' }))?.props.marginTop).toBe(-0)
  expect(await ui.find({ key: 'scroll-up' })).toBeUndefined()
  expect((await ui.find({ key: 'scroll-down' }))?.text).toContain('▼ 아래로 (17줄)')

  await ui.press({ key: 'scroll-down' })
  expect((await ui.find({ key: 'viewport-body' }))?.props.marginTop).toBe(-7)
  expect((await ui.find({ key: 'scroll-up' }))?.text).toContain('▲ 위로 (7줄)')
  expect((await ui.find({ key: 'scroll-down' }))?.text).toContain('▼ 아래로 (10줄)')
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
  expect(await ui.find({ type: 'Text', text: /^▾ 결과물$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- 커밋 abc123$/ })).toBeDefined()

  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '막힘', item: 1, status: 'clear', note: '지윤님이 권한 부여' } as never)
  expect(await ui.find({ type: 'Text', text: /⛔ 막힘/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /↳ 해결: 지윤님이 권한 부여/ })).toBeDefined()

  // 같은 문구로 단계를 다시 써도 막힘·처리 내역은 이어진다.
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '막힘', items: ['배포', '확인', '마무리'] } as never)
  expect(await ui.find({ type: 'Text', text: /⏳ 대기: 지윤님 확인/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- 커밋 abc123$/ })).toBeDefined()
})

test('지금 하는 단계(안 끝난 첫 단계)는 ▶ 와 테마의 배경색으로, 제목 아래엔 세션과 갱신 시각이 보이고, [닫기] 버튼은 없다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '현재 단계', items: ['가', '나', '다'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '현재 단계', items: [1] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect((await ui.find({ key: 'chk-1' }))?.props.label).toBe('▶ 나')
  expect((await ui.find({ type: 'Text', text: /^나$/ }))?.props.backgroundColor).toBe('diffAdded')
  expect((await ui.find({ key: 'chk-2' }))?.props.label).toBe('☐ 다')
  expect(await ui.find({ type: 'Text', text: /· (방금|[0-9]+분 전) 갱신$/ })).toBeDefined()
  expect(await ui.find({ key: 'close' })).toBeUndefined()
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

// 세션 이름: classic 훅(관리형 설정 PC 에서 막힘) 없이 <CLAUDE_CONFIG_DIR>/projects/<작업 폴더>/<세션 id>.jsonl 을 읽는다.
// 키를 / 로 시작하게 두면 엔진이 OS 에 맞는 절대 경로로 바꿔 읽어도 fakeFiles 가 끝부분으로 찾는다.
const CONFIG_DIR = '/notes-test/.claude'
const TRANSCRIPT = `${CONFIG_DIR}/projects/-w/s1.jsonl`

test('세션 이름은 대화 기록의 마지막 /rename 이름을 쓰고, 이름을 바꾸면 30초 주기에 반영된다', async ($, on) => {
  const { files, reads } = fakeFiles(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG_DIR })
  const clock = mock.clock(on)
  files.set(TRANSCRIPT, '{"type":"ai-title","aiTitle":"자동 제목"}\n')
  await startSession($, on, { hasClock: true })
  await clock.settle()
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '이름', items: ['가'] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(reads.some(p => p.endsWith(TRANSCRIPT))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^자동 제목 · / })).toBeDefined()

  files.set(TRANSCRIPT, '{"type":"ai-title","aiTitle":"자동 제목"}\n{"type":"custom-title","customTitle":"mod"}\n')
  await clock.advance(30000)
  expect(await ui.find({ type: 'Text', text: /^mod · / })).toBeDefined()
})

test('데스크톱에서는 목표·종료 조건·결과물·메모를 Markdown 으로 그려 글자를 고를 수 있게 한다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '선택', goal: '목표 글', done_when: '끝', items: ['가'], results: ['PR https://x.com/1'], memo: '첫\n- 둘' } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'desktop', component: 'Pane', requestId: 'notes', props: PANE })
  expect((await ui.find({ key: 'goal-md' }))?.props.text).toBe('목표 글')
  expect((await ui.find({ key: 'results-md' }))?.props.text).toBe('- PR [https://x.com/1](https://x.com/1)')
  expect((await ui.find({ key: 'memo-md' }))?.props.text).toBe('- 첫\n- 둘')
})

test('rename 한 이름은 세션 폴더의 custom-title.json 에서 3초 안에 읽는다(대화 기록이 커도)', async ($, on) => {
  const { files } = fakeFiles(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: CONFIG_DIR })
  const clock = mock.clock(on)
  files.set(TRANSCRIPT, '{"type":"ai-title","aiTitle":"자동"}\n')
  await startSession($, on, { hasClock: true })
  await clock.settle()
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '이름2', items: ['가'] } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ type: 'Text', text: /^자동 · / })).toBeDefined()

  files.set(`${CONFIG_DIR}/projects/-w/s1/custom-title.json`, '{"customTitle":"mod"}')
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /^mod · / })).toBeDefined()
})

test('구역 제목을 누르면 접히고 요약만 남으며, 다시 누르면 펴진다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '접기', items: ['가', '나'], memo: '첫\n둘' } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '접기', items: [1] } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })

  await ui.press({ key: 'fold-items' })
  expect(await ui.find({ key: 'chk-0' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^▸ 할 일$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(1\/2\)/ })).toBeDefined()

  await ui.press({ key: 'fold-memo' })
  expect(await ui.find({ type: 'Text', text: /^- 첫$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\(2줄\)/ })).toBeDefined()

  await ui.press({ key: 'fold-items' })
  expect(await ui.find({ key: 'chk-0' })).toBeDefined()
})

test('본문이 창보다 길어도 구역 상자가 눌려 줄지 않는다(빈 줄·할 일 제목이 사라지지 않게)', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  const items = Array.from({ length: 20 }, (_, n) => `단계 ${n + 1}`)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '긴 탭3', goal: '목표', done_when: '끝', items, memo: '가\n나' } as never)

  // 스크롤 창: 높이 고정 + 넘침 숨김 안에서 본문은 제 높이를 지켜야 잘려 보인다(눌리면 줄끼리 겹친다).
  const small = { ...PANE, scroll: { offset: 0, bodyRows: 15 } }
  const scrolled = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: small as never })
  expect((await scrolled.find({ key: 'viewport-body' }))?.props.flexShrink).toBe(0)
  await scrolled.unmount()

  // 다 들어간다고 어림한 경우에도 줄 수 어림이 틀릴 수 있으니 본문은 눌리지 않는다.
  const big = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await big.find({ key: 'viewport' })).toBeUndefined()
  expect((await big.find({ key: 'content' }))?.props.flexShrink).toBe(0)
})

// 대화창의 notes 도구 호출 줄. 설정 callDisplay: 요약(기본) / 숨김 / 원래대로.
const callRow = (tool: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  component: 'ToolUse' as const,
  requestId: 'tu1',
  props: { tool_use_id: 'tu1', tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra } as never,
})
const resultRow = (tool: string) => ({
  component: 'ToolResult' as const,
  requestId: 'tu1',
  props: { tool_use_id: 'tu1', tool, output: '# 긴 탭 전체 내용', isErrored: false } as never,
})

// 엔진 대역: notes 가 넘긴(next) 줄은 엔진이 원래 그리던 줄로 그린다.
function engineRows(on: On) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return (<Text key="engine-row">engine</Text>) as never
  })
}

test('기본(요약): notes 호출은 한 줄 요약으로, 결과 칸은 비운다', async ($, on) => {
  engineRows(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const check = await $.ui.mount({ plugin: 'notes', surface, ...callRow('mcp__notes__notes_check', { tab: '배포', items: [2, 3] }) })
    expect((await check.find({ key: 'notes-call' }))?.text).toContain('배포 · #2, #3 체크')
    await check.unmount()

    const write = await $.ui.mount({ plugin: 'notes', surface, ...callRow('mcp__notes__notes_write', { tab: '배포', add_items: ['a', 'b'] }) })
    expect((await write.find({ key: 'notes-call' }))?.text).toContain('배포 · 단계 2개 추가')
    await write.unmount()

    const status = await $.ui.mount({ plugin: 'notes', surface, ...callRow('mcp__notes__notes_status', { tab: '배포', item: 4, status: 'blocked' }) })
    expect((await status.find({ key: 'notes-call' }))?.text).toContain('배포 · #4 막힘')
    await status.unmount()

    const failed = await $.ui.mount({ plugin: 'notes', surface, ...callRow('mcp__notes__notes_read', {}, { isErrored: true }) })
    expect((await failed.find({ key: 'notes-call' }))?.text).toContain('실패')
    await failed.unmount()

    const result = await $.ui.mount({ plugin: 'notes', surface, ...resultRow('mcp__notes__notes_check') })
    expect(await result.find({ type: 'Text', text: /긴 탭/ })).toBeUndefined()
    expect(await result.find({ key: 'notes-result' })).toBeDefined()
    await result.unmount()
  }
})

test('다른 도구의 줄은 건드리지 않는다', async ($, on) => {
  engineRows(on)
  const bash = await $.ui.mount({ plugin: 'notes', surface: 'terminal', ...callRow('Bash', { command: 'ls' }) })
  expect(await bash.find({ key: 'notes-call' })).toBeUndefined()
  expect(await bash.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
})

test('숨김: notes 호출 줄과 결과 칸이 모두 비어 있다', { options: { callDisplay: '숨김' } }, async ($, on) => {
  engineRows(on)
  const row = await $.ui.mount({ plugin: 'notes', surface: 'terminal', ...callRow('mcp__notes__notes_check', { tab: '배포', items: [1] }) })
  expect(await row.find({ key: 'notes-call' })).toBeUndefined()
  expect(await row.find({ key: 'notes-hidden' })).toBeDefined()
})

test('원래대로: notes 호출 줄을 엔진이 그리던 대로 둔다', { options: { callDisplay: '원래대로' } }, async ($, on) => {
  engineRows(on)
  const row = await $.ui.mount({ plugin: 'notes', surface: 'terminal', ...callRow('mcp__notes__notes_check', { tab: '배포', items: [1] }) })
  expect(await row.find({ key: 'notes-call' })).toBeUndefined()
  expect(await row.find({ key: 'notes-hidden' })).toBeUndefined()
  expect(await row.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  const result = await $.ui.mount({ plugin: 'notes', surface: 'terminal', ...resultRow('mcp__notes__notes_check') })
  expect(await result.find({ key: 'notes-result' })).toBeUndefined()
  expect(await result.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
})

test('터미널에서는 왼쪽 구분선과 붙지 않게 창 내용을 한 칸 띄운다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  const empty = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect((await empty.find({ key: 'pane-root' }))?.props.paddingLeft).toBe(1)
  await empty.unmount()

  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '여백', items: ['가'] } as never)
  const term = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect((await term.find({ key: 'pane-root' }))?.props.paddingLeft).toBe(1)
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'notes', surface: 'desktop', component: 'Pane', requestId: 'notes', props: PANE })
  expect((await desk.find({ key: 'pane-root' }))?.props.paddingLeft ?? 0).toBe(0)
})

test('헤드리스 세션에서는 notes 도구를 등록하지 않고, 사람이 있는 세션에서는 등록한다', async ($, on) => {
  fakeFiles(on)
  const registered: string[] = []
  on('tool.register', (_$, e) => {
    registered.push(e.name)
    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: '/w', surface: null, isInteractive: false } as never)
  expect(registered).toEqual([])

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(registered).toContain('notes_write')
})

test('설정에서 헤드리스를 켜면 헤드리스 세션도 notes 규칙과 도구를 받는다', { options: { headless: true } }, async ($, on) => {
  fakeFiles(on)
  const tools = await startSession($, on, { isInteractive: false })
  expect(tools.get('notes_write')).toContain('## 쓰는 법')
})

test('서브에이전트가 notes 도구를 부르면 거절하고 노트 파일에 쓰지 않는다', async ($, on) => {
  const { writes } = fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)

  for (const tool of ['notes_write', 'notes_check', 'notes_status', 'notes_read', 'notes_close']) {
    const res = await $.tool.call({ tool: `mcp__notes__${tool}`, tab: '서브', items: ['가'], agentId: 'sub-1' } as never)
    expect(String(res.deny ?? res.text)).toContain('메인 에이전트만')
  }
  expect(writes.length).toBe(0)

  const main = await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '메인', items: ['가'] } as never)
  expect(String(main.result)).toContain('#1 [ ] 가')
})

test('/clear 뒤처럼 세션 상태의 작업 폴더가 비어 있어도 이름 없는 .json 이 아니라 작업 폴더 노트 파일에 쓴다', { options: { shareScope: '같은 폴더' } }, async ($, on) => {
  const { writes } = fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)

  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '클리어 뒤', items: ['가'] } as never)

  expect(writes.some(p => p.endsWith('/w.json'))).toBe(true)
  expect(writes.some(p => p.endsWith('/.json'))).toBe(false)
})

// /clear 는 세션 상태(창이 보는 노트)를 비우고 session.start 는 다시 오지 않는다. classic.SessionStart(clear) 는
// 관리형 설정 PC 에서 막히므로 3초 주기 동기화가 파일을 다시 읽어 채운다(빈 작업 폴더는 위 테스트가 본다).
test('/clear 뒤처럼 창의 노트가 비어 있어도 3초 주기 동기화가 노트 파일을 다시 읽어 창에 보인다', { options: { shareScope: '같은 폴더' } }, async ($, on) => {
  const { files } = fakeFiles(on)
  const clock = mock.clock(on)
  await startSession($, on, { hasClock: true })
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ type: 'Text', text: /남은 탭/ })).toBeUndefined()

  files.set('/w.json', JSON.stringify({ root: '/w', tabs: [{ title: '남은 탭', items: [{ text: '가', isDone: false }], updatedAt: '2026-10-13T00:00:00Z' }], history: [], future: [] }))
  await clock.advance(3000)
  expect(await ui.find({ type: 'Text', text: /남은 탭/ })).toBeDefined()
})

test('안 끝난 단계에 막힘이 있으면 탭 이름이 error 색·⛔, 대기만 있으면 warning 색·⏳, 다 끝나면 원래대로', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '배포', items: ['A', 'B'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '조사', items: ['C'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '평범', items: ['D'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '배포', item: 1, status: 'waiting', note: '확인' } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '배포', item: 2, status: 'blocked', note: '권한' } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '조사', item: 1, status: 'waiting', note: '답' } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  // 마지막으로 표시를 단 '조사'가 지금 탭이다.
  expect((await ui.find({ type: 'Text', text: /^\[ ⛔ 배포 \]$/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /^▶ ⏳ 조사$/ }))?.props.color).toBe('warning')
  expect(await ui.find({ type: 'Button', text: /^\[ 평범 \]$/ })).toBeDefined()

  expect((await ui.find({ type: 'Text', text: /^▶ ⏳ 조사$/ }))?.props.italic).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^\[ ⛔ 배포 \]$/ }))?.props.italic).toBe(false)
  // 엔진은 테두리 있는 버튼을 통째로 굵게 칠하므로, 지금 탭이 아니면 plain 버튼 + 보통 굵기여야 한다.
  expect((await ui.find({ type: 'Text', text: /^\[ ⛔ 배포 \]$/ }))?.props.bold).toBe(false)
  expect((await ui.find({ type: 'Button', text: /^\[ 평범 \]$/ }))?.props.plain).toBe(true)

  await ui.press({ key: 'tab-평범' })
  expect((await ui.find({ type: 'Text', text: /^\[ ⏳ 조사 \]$/ }))?.props.color).toBe('warning')
  // 지금 탭은 기울인 글씨, 나머지는 바로 선 글씨.
  expect((await ui.find({ type: 'Text', text: /^▶ 평범$/ }))?.props.italic).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^\[ ⏳ 조사 \]$/ }))?.props.italic).toBe(false)

  // 대기 단계를 끝내면 대기 표시가 사라지고, 단계가 다 끝났으니 ✅ 가 붙는다.
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '조사', items: [1] } as never)
  expect(await ui.find({ type: 'Text', text: /^(\[ )?(▶ )?✅ 조사( \])?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⏳ 조사/ })).toBeUndefined()
})

const EN = { options: { language: 'English' } }

test('English: 사용 규칙·도구 결과·창 문구가 영어로 나온다', EN, async ($, on) => {
  fakeFiles(on)
  const tools = await startSession($, on)
  expect(tools.get('notes_write')).toContain('short English name')
  // 영어 규칙이 더 길다. 잘리지 않고 끝까지 가야 한다.
  expect(tools.get('notes_write')!.length).toBeLessThanOrEqual(TOOL_DESCRIPTION_MAX)

  const wrote = await $.tool.call({
    tool: 'mcp__notes__notes_write',
    tab: 'Deploy fix',
    goal: 'Ship it',
    done_when: 'CI green',
    items: ['Patch', 'Test'],
    memo: 'Push pending',
  } as never)
  expect(String(wrote.result)).toContain('Goal: Ship it')
  expect(String(wrote.result)).toContain('Done when: CI green')
  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: 'Deploy fix', item: 2, status: 'waiting', note: 'reviewer' } as never)

  const bad = await $.tool.call({ tool: 'mcp__notes__notes_check', tab: 'Nope', items: [1] } as never)
  expect(String(bad.deny)).toContain("No tab named 'Nope'.")

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ type: 'Text', text: /^▾ Done when$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^▾ To do$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⏳ waiting: reviewer/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /updated just now$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Delete tab/ })).toBeDefined()
  expect(await ui.find({ key: 'remove' })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Close/ })).toBeUndefined()
})

test('English: 대화창 요약 줄도 영어로 나온다', EN, async ($, on) => {
  engineRows(on)
  const check = await $.ui.mount({ plugin: 'notes', surface: 'terminal', ...callRow('mcp__notes__notes_check', { tab: 'Deploy', items: [2, 3] }) })
  expect((await check.find({ key: 'notes-call' }))?.text).toContain('Deploy · #2, #3 checked')
  await check.unmount()
  const write = await $.ui.mount({ plugin: 'notes', surface: 'terminal', ...callRow('mcp__notes__notes_write', { tab: 'Deploy', add_items: ['a'] }) })
  expect((await write.find({ key: 'notes-call' }))?.text).toContain('Deploy · +1 step')
})

test('모든 단계가 끝난 탭은 ✅ 를 붙이고 흐리게, 하나라도 남으면 표시가 없다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '끝남', items: ['A'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '끝남', items: [1] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '진행', items: ['B', 'C'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '진행', items: [1] } as never)

  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ type: 'Text', text: /^\[ ✅ 끝남 \]$/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', text: /^\[ ✅ 끝남 \]$/ }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^▶ 진행$/ })).toBeDefined()
})

// 질문 창(AskUserQuestion). ask(whileOpen) 은 창을 띄우고, 사람이 답하기 전(창이 떠 있는 동안)에 whileOpen 을 부른 뒤 답한다.
// 허락 창(권한 확인)은 💬 를 켜지 않는다: classic.PermissionRequest 는 관리형 설정 PC 에서 막히고 tool.check 의 ask 는 자동 모드 분류기까지 포함한다.
function questionDialog(on: On) {
  let whileOpen = async () => {}
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    await whileOpen()
    return { result: 'answered' } as never
  })
  return async ($: Engine, during: () => Promise<void> = async () => {}) => {
    whileOpen = during
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  }
}

test('질문 창이 떠 있는 동안 이 세션 탭에 💬, 답해서 그 도구 호출이 끝나면 일하는 중 ● 으로 바뀌고 상태 파일에 남는다', async ($, on) => {
  const { files } = fakeFiles(on)
  const ask = questionDialog(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }) as never)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '배포', items: ['A'] } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  const liveState = () => JSON.parse(files.get([...files.keys()].find(k => k.endsWith('/live/s1.json'))!)!).state

  let seen: unknown[] = []
  await ask($, async () => {
    seen = [(await ui.find({ type: 'Text', text: /^▶ 💬 배포$/ }))?.props.color, liveState()]
  })
  expect(seen).toEqual(['permission', 'ask'])
  expect((await ui.find({ type: 'Text', text: /^▶ ● 배포$/ }))?.props.color).toBe('success')
  expect(liveState()).toBe('working')

  // 다른 도구 호출(허락 창이 뜰 수 있는 Bash 포함)은 💬 를 켜지 않는다.
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(await ui.find({ type: 'Text', text: /💬/ })).toBeUndefined()
})

test('막힘은 💬 보다, 💬 는 대기보다 먼저 보인다', async ($, on) => {
  fakeFiles(on)
  const ask = questionDialog(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '배포', items: ['A', 'B'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '배포', item: 1, status: 'waiting', note: '확인' } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  const marks: unknown[] = []
  await ask($, async () => {
    marks.push(await ui.find({ type: 'Text', text: /^▶ 💬 배포$/ }))
    await $.tool.call({ tool: 'mcp__notes__notes_status', tab: '배포', item: 2, status: 'blocked', note: '권한' } as never)
    marks.push(await ui.find({ type: 'Text', text: /^▶ ⛔ 배포$/ }))
  })
  expect(marks.every(m => m !== undefined)).toBe(true)
})

// 공유 범위(shareScope): 전체(기본) = _all.json, 같은 폴더 = <작업 폴더>.json, 세션마다 = sessions/<세션 id>.json.
const saveFile = (root: string, title: string, updatedAt = '2026-10-13T00:00:00Z') =>
  JSON.stringify({ root, tabs: [{ title, items: [{ text: '가', isDone: false }], updatedAt }], history: [], future: [] })

test('기본(전체): 작업 폴더와 상관없이 한 파일에 쓰고, 다른 폴더 세션이 쓴 탭도 보인다', async ($, on) => {
  const { files, writes } = fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  files.set('/_all.json', saveFile('/other', '다른 폴더 탭'))

  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '내 탭', items: ['A'] } as never)

  expect(writes.every(p => p.endsWith('/_all.json'))).toBe(true)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ key: 'tab-다른 폴더 탭' })).toBeDefined()
  expect(await ui.find({ key: 'tab-내 탭' })).toBeDefined()
})

test('같은 폴더: 작업 폴더 파일에만 쓴다', { options: { shareScope: '같은 폴더' } }, async ($, on) => {
  const { writes } = fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '내 탭', items: ['A'] } as never)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatch(/\/w\.json$/)
})

test('세션마다: 세션 id 파일에 쓰고 다른 세션 노트는 보이지 않는다', { options: { shareScope: '세션마다' } }, async ($, on) => {
  const { files, writes } = fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  files.set('/_all.json', saveFile('/w', '전체 탭'))
  files.set('/w.json', saveFile('/w', '폴더 탭'))

  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '내 탭', items: ['A'] } as never)

  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatch(/\/sessions\/s1\.json$/)
  const read = await $.tool.call({ tool: 'mcp__notes__notes_read' } as never)
  expect(String(read.result)).toContain('내 탭')
  expect(String(read.result)).not.toContain('전체 탭')
  expect(String(read.result)).not.toContain('폴더 탭')
})

test('전체: 공유 파일이 없으면 세션 시작 때 폴더별 노트를 모아 만든다(같은 이름은 최근 것)', async ($, on) => {
  const { files } = fakeFiles(on)
  files.set('/a.json', saveFile('/a', '겹침', '2026-10-01T00:00:00Z'))
  files.set('/b.json', JSON.stringify({ root: '/b', tabs: [{ title: '겹침', items: [], memo: '새것', updatedAt: '2026-10-05T00:00:00Z' }, { title: 'B 탭', items: [], updatedAt: '2026-10-03T00:00:00Z' }] }))
  on('fs.list', () => ({ value: [{ name: 'a.json', kind: 'file' }, { name: 'b.json', kind: 'file' }, { name: 'live', kind: 'dir' }] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('clock.every', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)

  const shared = [...files].find(([k]) => k.endsWith('/_all.json'))
  expect(shared).toBeDefined()
  const tabs = (JSON.parse(shared![1]) as { tabs: { title: string; memo?: string }[] }).tabs
  expect(tabs.map(t => t.title)).toEqual(['B 탭', '겹침'])
  expect(tabs[1]!.memo).toBe('새것')
})

// 테마(theme·background): 터미널 창에만 칠한다. 기본은 Claude Code 테마(/theme)의 색 이름을 쓴다.
async function mountWithTab($: Engine, on: On, surface: 'terminal' | 'desktop' = 'terminal') {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '테마', items: ['지금 단계', '다음'] } as never)
  return $.ui.mount({ plugin: 'notes', surface, component: 'Pane', requestId: 'notes', props: PANE })
}

test('기본 테마: 창 배경을 칠하지 않고 지금 단계는 테마의 diffAdded 배경', async ($, on) => {
  const ui = await mountWithTab($, on)
  expect((await ui.find({ key: 'pane-root' }))?.props.backgroundColor).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^지금 단계$/ }))?.props.backgroundColor).toBe('diffAdded')
})

test('기본 테마: 탭 줄 테두리와 버튼 밑 가로줄은 본체 입력창 테두리 색(promptBorder), 지금 탭 ▶ 는 suggestion', async ($, on) => {
  const ui = await mountWithTab($, on)
  expect((await ui.find({ key: 'tab-strip' }))?.props.borderColor).toBe('promptBorder')
  const rule = await ui.find({ type: 'Text', text: /^─+$/ })
  expect(rule?.props.color).toBe('promptBorder')
  expect(rule?.props.dimColor).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /^▶ $/ }))?.props.color).toBe('suggestion')
})

test('어둡게: 탭 줄 테두리·▶ 는 테마 색 그대로, 버튼 밑 가로줄은 흐린 글자색', { options: { theme: '어둡게' } }, async ($, on) => {
  const ui = await mountWithTab($, on)
  expect((await ui.find({ key: 'tab-strip' }))?.props.borderColor).toBe('#7aa2f7')
  const rule = await ui.find({ type: 'Text', text: /^─+$/ })
  expect(rule?.props.color).toBe('#e6e9ef')
  expect(rule?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^▶ $/ }))?.props.color).toBe('#7aa2f7')
})

test('밝게: 창 배경과 글자색, 지금 단계 색이 테마 색으로 바뀐다', { options: { theme: '밝게' } }, async ($, on) => {
  const ui = await mountWithTab($, on)
  expect((await ui.find({ key: 'pane-root' }))?.props.backgroundColor).toBe('#fafafa')
  expect((await ui.find({ type: 'Text', text: /^다음$/ }))?.props.color).toBe('#1f2328')
  expect((await ui.find({ type: 'Text', text: /^지금 단계$/ }))?.props.backgroundColor).toBe('#d6f0dc')
})

test('배경색 직접 지정은 테마 배경을 덮어쓴다', { options: { theme: '어둡게', background: '#112233' } }, async ($, on) => {
  const ui = await mountWithTab($, on)
  expect((await ui.find({ key: 'pane-root' }))?.props.backgroundColor).toBe('#112233')
})

test('배경색이 색 코드가 아니면 테마 배경을 쓴다', { options: { theme: '어둡게', background: 'blue; rm' } }, async ($, on) => {
  const ui = await mountWithTab($, on)
  expect((await ui.find({ key: 'pane-root' }))?.props.backgroundColor).toBe('#1e2230')
})

test('데스크톱 등 터미널이 아닌 화면에는 테마를 칠하지 않는다', { options: { theme: '고대비' } }, async ($, on) => {
  const ui = await mountWithTab($, on, 'desktop')
  expect((await ui.find({ key: 'pane-root' }))?.props.backgroundColor).toBeUndefined()
})

test('/notes 는 창이 보이면 닫고, 닫혀 있으면 연다', async ($, on) => {
  fakeFiles(on)
  let isShown = false
  const calls: string[] = []
  on('ui.panes', () => ({ value: isShown ? [{ id: 'notes', title: 'notes', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never)
  on('ui.open', () => {
    calls.push('open')
    isShown = true
    return { value: { isPlaced: true } } as const
  })
  on('ui.close', () => {
    calls.push('close')
    isShown = false
    return { value: undefined } as never
  })

  const first = await $.command.run({ command: 'notes', args: '' } as never)
  const second = await $.command.run({ command: 'notes', args: '' } as never)

  expect(calls).toEqual(['open', 'close'])
  expect(String((first as { text?: string }).text)).toContain('열었습니다')
  expect(String((second as { text?: string }).text)).toContain('닫았습니다')
})

test('다 끝난 탭은 그 세션이 일하는 중이어도 ● 대신 ✅ 만 보인다', async ($, on) => {
  fakeFiles(on)
  const ask = questionDialog(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '끝난 일', items: ['A'] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '끝난 일', items: [1] } as never)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '하는 일', items: ['B'] } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })

  // 질문 창(💬)이 떠도 다 끝난 탭은 ✅ 그대로. 답하고 나면(도구 호출 끝) 이 세션은 일하는 중.
  const whileOpen: unknown[] = []
  await ask($, async () => {
    whileOpen.push(await ui.find({ type: 'Text', text: /^\[ ✅ 끝난 일 \]$/ }), await ui.find({ type: 'Text', text: /^▶ 💬 하는 일$/ }))
  })
  expect(whileOpen.every(m => m !== undefined)).toBe(true)

  expect(await ui.find({ type: 'Text', text: /^\[ ✅ 끝난 일 \]$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /● 끝난 일/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^▶ ● 하는 일$/ })).toBeDefined()
})

test('버튼 줄은 탭 줄 바로 다음 한 줄(테두리 없음)이고, 본문 제목보다 앞에 온다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '버튼 위치', items: ['가'] } as never)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  const bar = await ui.find({ key: 'bar' })
  expect(bar?.props.borderStyle).toBeUndefined()
  expect(bar?.props.flexWrap).toBeUndefined()
  // 버튼 밑에 본문과 구분하는 가로줄 한 줄.
  expect((await ui.find({ key: 'bar-line' }))?.props.height).toBe(1)
  expect((await ui.find({ key: 'bar-line' }))?.text).toMatch(/^─+$/)
  // 그린 순서: 탭 버튼 → [탭 지우기] → 본문의 단계 체크 버튼.
  const keys = (await ui.findAll({ type: 'Button' })).map(x => x.key)
  expect(keys.indexOf('remove')).toBeGreaterThan(keys.indexOf('tab-버튼 위치'))
  expect(keys.indexOf('remove')).toBeLessThan(keys.indexOf('chk-0'))
})

test('창이 넉넉하면 버튼에 글자와 무엇을 되돌리는지까지, 좁으면 글자만, 더 좁으면 아이콘만 보인다', async ($, on) => {
  fakeFiles(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '폭', items: ['가'] } as never)
  const at = (bodyColumns: number) =>
    $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: { ...PANE, bodyColumns } as never })

  const wide = await at(80)
  expect((await wide.find({ key: 'remove' }))?.text).toContain('✕ 탭 지우기')
  expect((await wide.find({ key: 'undo' }))?.text).toMatch(/↶ 되돌리기: /)
  await wide.unmount()

  const mid = await at(36)
  expect((await mid.find({ key: 'remove' }))?.text).toContain('✕ 탭 지우기')
  expect((await mid.find({ key: 'undo' }))?.text).toMatch(/↶ 되돌리기(?!:)/)
  await mid.unmount()

  const narrow = await at(20)
  expect((await narrow.find({ key: 'remove' }))?.text).not.toContain('탭 지우기')
  expect((await narrow.find({ key: 'remove' }))?.text).toContain('✕')
  expect((await narrow.find({ key: 'undo' }))?.text).toContain('↶')
  expect((await narrow.find({ key: 'undo' }))?.text).not.toContain('되돌리기')
})

test('●·💬 는 그 세션이 가장 최근에 고친 탭에만 켜지고, 앞서 하던 안 끝난 탭은 꺼진다', async ($, on) => {
  fakeFiles(on)
  const ask = questionDialog(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as const)
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '하던 일', items: ['A', 'B'] } as never)
  // 질문 창 → 답함 = 이 세션은 일하는 중.
  await ask($)
  const ui = await $.ui.mount({ plugin: 'notes', surface: 'terminal', component: 'Pane', requestId: 'notes', props: PANE })
  expect(await ui.find({ type: 'Text', text: /^▶ ● 하던 일$/ })).toBeDefined()

  await new Promise(r => setTimeout(r, 5))
  await $.tool.call({ tool: 'mcp__notes__notes_write', tab: '새 일', items: ['C'] } as never)
  expect(await ui.find({ type: 'Text', text: /^▶ ● 새 일$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\[ 하던 일 \]$/ })).toBeDefined()

  // 예전 탭을 다시 고치면 그쪽으로 옮겨 간다.
  await new Promise(r => setTimeout(r, 5))
  await $.tool.call({ tool: 'mcp__notes__notes_check', tab: '하던 일', items: [1] } as never)
  expect(await ui.find({ type: 'Text', text: /^▶ ● 하던 일$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\[ 새 일 \]$/ })).toBeDefined()
})
