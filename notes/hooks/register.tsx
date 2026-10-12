import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { NoteChange, NoteChangePart, NoteItem, NotesBook, NoteTab } from '../types'

const PANE = 'notes'
const MAX_TABS = 30
const MAX_HISTORY = 20
const book = atom({ plugin: 'notes', key: 'book' } as const, { root: '', tabs: [], history: [], future: [] } as NotesBook)
const scroll = atom({ plugin: 'notes', key: 'scroll' } as const, 0)

const SYNC_MS = 3000
// 노트는 <.claude>/notes-data/<작업 폴더>.json 한 파일에 둔다. 같은 폴더의 세션들이 이 파일을 함께 읽고 쓴다.
// 마켓플레이스 설치본은 버전마다 폴더가 바뀌므로 모드 폴더 밖에 둔다. .claude 아래가 아니면 모드 폴더의 data/.
const dataDir = (pluginRoot: string) => {
  const claudeDir = pluginRoot.match(/^(.*?[\\/]\.claude)[\\/]/)?.[1]
  return claudeDir === undefined ? `${pluginRoot}/data` : `${claudeDir}/notes-data`
}
const dataPath = ($: EngineInterface, root: string) =>
  `${dataDir($.plugin.root)}/${root.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`
const now = () => new Date().toISOString()
const asText = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)
const asList = (v: unknown) =>
  Array.isArray(v) ? v.map(asText).filter((s): s is string => s !== undefined) : []

const findTab = (b: NotesBook, title: string | undefined) =>
  title === undefined ? undefined : b.tabs.find(t => t.title === title)

const describeTab = (t: NoteTab) => {
  const done = t.items.filter(i => i.isDone).length
  const lines = [`# ${t.title} (${done}/${t.items.length})`]
  if (t.goal) lines.push(`목표: ${t.goal}`)
  if (t.doneWhen) lines.push(`종료 조건: ${t.doneWhen}`)
  t.items.forEach((i, n) => lines.push(`#${n + 1} [${i.isDone ? 'x' : ' '}] ${i.text}`))
  if (t.memo) lines.push(`메모: ${t.memo}`)
  return lines.join('\n')
}

// history = 되돌릴 수 있는 변경(오래된 것부터), future = 되돌린 뒤 다시 할 수 있는 변경(가장 최근에 되돌린 것이 끝).
type Saved = { tabs: NoteTab[]; history: NoteChange[]; future: NoteChange[] }

const asChanges = (v: unknown) => (Array.isArray(v) ? (v as NoteChange[]) : [])
async function loadFile($: EngineInterface, root: string): Promise<Saved> {
  try {
    const saved = JSON.parse(await $.fs.read(dataPath($, root))) as Partial<Saved>
    return { tabs: Array.isArray(saved.tabs) ? saved.tabs : [], history: asChanges(saved.history), future: asChanges(saved.future) }
  } catch {
    return { tabs: [], history: [], future: [] }
  }
}

// 바뀐 탭만 골라 되돌리기 기록을 만든다. 보는 탭만 바꾼 경우처럼 내용이 그대로면 빈 목록.
function diffTabs(before: NoteTab[], after: NoteTab[]): NoteChangePart[] {
  const parts: NoteChangePart[] = []
  before.forEach((o, index) => {
    const n = after.find(t => t.title === o.title)
    if (n === undefined) parts.push({ index, before: o })
    else if (JSON.stringify(n) !== JSON.stringify(o)) parts.push({ index, before: o, afterTitle: o.title })
  })
  after.forEach((n, index) => {
    if (!before.some(o => o.title === n.title)) parts.push({ index, afterTitle: n.title })
  })
  return parts
}

// 기록 한 건을 거꾸로 적용한다: 바뀐 뒤 탭을 빼고, 바뀌기 전 탭을 원래 자리에 되돌린다.
function revert(tabs: NoteTab[], entry: NoteChange): NoteTab[] {
  const gone = new Set(entry.parts.flatMap(p => (p.afterTitle === undefined ? [] : [p.afterTitle])))
  const back = entry.parts.flatMap(p => (p.before === undefined ? [] : [p])).sort((x, y) => x.index - y.index)
  const result = tabs.filter(t => !gone.has(t.title) && !back.some(p => p.before!.title === t.title))
  for (const p of back) result.splice(Math.min(p.index, result.length), 0, p.before!)
  return result
}

async function save($: EngineInterface, root: string, saved: Saved) {
  await $.fs.write(dataPath($, root), JSON.stringify({ root, ...saved }, null, 1))
}

// 다른 세션이 고친 내용을 덮어쓰지 않도록, 고치기 직전에 파일의 최신본을 다시 읽어 그 위에 반영한다.
// label 은 되돌리기 버튼에 보일 설명이다. 새로 고치면 앞으로가기 기록은 버린다.
async function change($: EngineInterface, label: string, fn: (b: NotesBook) => NotesBook) {
  const { root } = await read($, book)
  const saved = await loadFile($, root)
  const next = await update($, book, cur => fn({ ...cur, ...saved }))
  const parts = diffTabs(saved.tabs, next.tabs)
  if (parts.length === 0) return next
  const history = [...saved.history, { label, at: now(), parts }].slice(-MAX_HISTORY)
  await save($, root, { tabs: next.tabs, history, future: [] })
  return update($, book, c => ({ ...c, history, future: [] }))
}

// 기록 한쪽(from)의 마지막 변경을 거꾸로 적용하고, 그 반대 방향 기록을 다른 쪽(to)에 쌓는다.
// 되돌리기는 history → future, 앞으로가기는 future → history.
async function step($: EngineInterface, from: 'history' | 'future') {
  const to = from === 'history' ? 'future' : 'history'
  const { root } = await read($, book)
  const saved = await loadFile($, root)
  const entry = saved[from].at(-1)
  if (entry === undefined) return
  const tabs = revert(saved.tabs, entry)
  const back: NoteChange = { label: entry.label, at: now(), parts: diffTabs(saved.tabs, tabs) }
  const next: Saved = { tabs, [from]: saved[from].slice(0, -1), [to]: [...saved[to], back].slice(-MAX_HISTORY) } as Saved
  await save($, root, next)
  await update($, book, c => ({ ...c, ...next, active: tabs.some(t => t.title === c.active) ? c.active : tabs.at(-1)?.title }))
}
const undo = ($: EngineInterface) => step($, 'history')
const redo = ($: EngineInterface) => step($, 'future')

// 다른 세션의 변경을 이 세션 화면에 반영한다.
async function sync($: EngineInterface) {
  const cur = await read($, book)
  const saved = await loadFile($, cur.root)
  if (JSON.stringify(saved) === JSON.stringify({ tabs: cur.tabs, history: cur.history, future: cur.future ?? [] })) return
  await update($, book, c => ({ ...c, ...saved, active: saved.tabs.some(t => t.title === c.active) ? c.active : saved.tabs.at(-1)?.title }))
}

// 하단 버튼 줄: 상단 탭 줄과 같은 둥근 테두리 상자.
const buttonBar = (Box: ElementConstructor<BoxProps>, buttons: RenderChildren[]) => (
  <Box flexDirection="row" flexWrap="wrap" columnGap={1} borderStyle="round" borderColor="gray" paddingX={1}>
    {buttons.filter(Boolean)}
  </Box>
)

// 터미널에서 글자가 차지하는 칸 수. 한글·한자·전각 문자와 체크 칸은 두 칸으로 센다.
const WIDE = /[ᄀ-ᅟ☐-☒⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const cellWidth = (s: string) => [...s].reduce((w, ch) => w + (WIDE.test(ch) ? 2 : 1), 0)
// 폭 cols 에 접혀 들어갈 때 몇 줄이 되는지(대략).
const textRows = (s: string, cols: number) => Math.max(1, Math.ceil(cellWidth(s) / Math.max(1, cols)))

// 마지막으로 그린 탭에서 본문을 내릴 수 있는 최대 줄 수. 휠이 끝을 넘지 않게 그릴 때마다 갱신한다.
let maxScroll = 0

const ok = (text: string) => ({ result: text })
const failed = () => ({ deny: 'notes 모드 처리 중 오류가 났습니다.' })

// 매 세션 시스템 프롬프트 끝에 붙는 사용 규칙. 고정 문구라 프롬프트 캐시를 깨지 않는다.
const GUIDE = [
  '# notes (사용자 옆 창 노트)',
  '사용자는 옆 창의 notes 로 작업 진행 상황을 본다. 대화를 위로 올려 찾지 않아도 되게 하는 것이 목적이다.',
  '',
  '## 언제 탭을 만드나 — 아래 중 하나라도 해당하면 첫 작업(도구 호출) 전에 notes_write 로 탭부터 만든다',
  '- 할 일이 2개 이상이다. 사용자가 단계를 직접 정해 준 요청(예: "A 고치고, 검사하고, 답변 달아줘")도 포함한다. 그 단계를 그대로 items 로 옮긴다.',
  '- 파일 수정, 배포·발행, 슬랙·위키·JIRA 게시처럼 결과가 남는 작업이 들어 있다.',
  '- 조사·확인 요청이라도 끝에 판단이나 선택지(A/B/C안 등)를 사용자에게 넘기게 된다. 이때는 조사 단계와 "사용자 결정 대기"를 items 로 적는다.',
  '- 스킬 절차를 따라 여러 단계를 진행한다.',
  '쓰지 않는 경우: 한 번 조회하고 답하면 끝나는 질문, 잡담, 설명 요청.',
  '',
  '## 쓰는 법',
  '- 탭 이름은 작업을 알아보기 쉬운 짧은 한글(15자 이내)로 직접 짓는다. 이어지는 후속 요청이면 새 탭 대신 기존 탭에 add_items 로 덧붙인다.',
  '- 단계 하나를 끝낼 때마다 바로 notes_check 로 체크한다. 몰아서 체크하지 않는다.',
  '- 종료 조건·완료 기준이 정해지면 done_when 에 적는다.',
  '- 사용자가 꼭 봐야 할 것(결정 사항, 주의점, 사용자에게 넘긴 확인 요청, 커밋·푸시 대기 같은 남은 일)은 memo 에 적는다.',
  '- memo 는 할 일이 아니라 참고 사항이다. 여러 건이면 한 건씩 줄을 바꿔 쓴다. 해야 할 일은 memo 가 아니라 items 에 넣는다.',
  '- 계획이 바뀌면 items 로 단계를 고친다.',
  '- 창은 단계에 번호를 붙이지 않는다. 순서가 중요하면 문구 앞에 번호를 직접 붙인다(예: "1. ...", 하위 단계는 "1-1. ..."). 결정·질문 같은 단계에는 번호 대신 [결정] 같은 머리표를 써도 된다. 번호를 쓰면 탭 안에서 빠지거나 겹치지 않게 1부터 차례로 맞춘다.',
  '- notes_read 결과의 #N 은 위치 번호(notes_check 에 넘기는 값)이고 문구 속 번호와 다를 수 있다.',
  '- 사용자가 다른 주제로 넘어가면 기존 탭은 그대로 두고 새 탭을 만든다.',
  '- 사용자가 "아까 거 어디까지 했지" 처럼 이전 작업을 물으면 먼저 notes_read 로 확인하고 답한다.',
  '- 탭 삭제(notes_close)는 사용자가 정리를 원할 때만 한다.',
].join('\n')

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, { id: 'notes:guide', text: GUIDE, scope: 'session' }] }
  })

  on('session.start', async ($, e, next) => {
    const root = await $.session.root()
    const saved = await loadFile($, root)
    await update($, book, () => ({ root, ...saved, active: saved.tabs.at(-1)?.title }))
    $.clock.every(SYNC_MS, () => void sync($))

    await $.command.register({ name: 'notes', description: '노트 옆 창 열기 (계획·진행상황·종료 조건)' })
    await $.tool.register({
      name: 'notes_write',
      isDeferred: false,
      description:
        '사용자가 바로 볼 노트 탭을 만들거나 고친다(옆 창에 표시, 작업 폴더별 유지). ' +
        '할 일이 2개 이상이거나(사용자가 단계를 정해 준 요청 포함) 파일 수정·게시처럼 결과가 남는 작업이면 첫 작업 전에 탭을 만들어 단계를 items 로 적고, 종료 조건이 있으면 done_when 에 적는다. ' +
        '탭 이름(tab)은 작업 내용을 알아보기 쉬운 짧은 한글로 직접 짓는다(15자 이내). 같은 이름이 있으면 준 값만 고친다. ' +
        'items 는 단계 전체를 바꾸고, add_items 는 끝에 덧붙인다.',
      inputSchema: {
        type: 'object',
        properties: {
          tab: { type: 'string', description: '탭 이름' },
          goal: { type: 'string', description: '이 작업의 목표 한 줄' },
          done_when: { type: 'string', description: '종료 조건' },
          items: { type: 'array', items: { type: 'string' }, description: '단계 목록 전체(기존 체크 상태는 같은 문구면 유지)' },
          add_items: { type: 'array', items: { type: 'string' }, description: '끝에 덧붙일 단계' },
          memo: { type: 'string', description: '사용자가 바로 봐야 할 메모(결정 사항·주의점 등)' },
        },
        required: ['tab'],
      },
    })
    await $.tool.register({
      name: 'notes_check',
      isDeferred: false,
      description: '노트 탭의 단계를 완료(또는 미완료)로 표시한다. 단계를 끝낼 때마다 바로 부른다. items 에는 notes_read 결과의 #N 위치 번호(1부터)를 넘긴다. 문구 속 번호가 아니다.',
      inputSchema: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          items: { type: 'array', items: { type: 'integer' }, description: '위치 번호 #N (1부터, 문구 속 번호 아님)' },
          done: { type: 'boolean', description: '기본 true, false 면 완료 취소' },
        },
        required: ['tab', 'items'],
      },
    })
    await $.tool.register({
      name: 'notes_read',
      isDeferred: false,
      description:
        '노트를 읽는다. tab 을 빼면 탭 목록과 진행률. 사용자가 "아까 거 어디까지 했지" 처럼 이전 작업을 물으면 먼저 부른다.',
      inputSchema: { type: 'object', properties: { tab: { type: 'string' } } },
    })
    await $.tool.register({
      name: 'notes_close',
      isDeferred: false,
      description: '다 끝났거나 필요 없어진 노트 탭을 지운다. 사용자가 정리를 원할 때만 부른다.',
      inputSchema: { type: 'object', properties: { tab: { type: 'string' } }, required: ['tab'] },
    })

    return next(e)
  })

  on('command.run', { command: 'notes' }, async $ => {
    await $.ui.open({ id: PANE, title: 'notes' })
    const b = await read($, book)
    return { text: b.tabs.length === 0 ? '노트 창을 열었습니다. 아직 탭이 없습니다.' : `노트 창을 열었습니다. 탭 ${b.tabs.length}개.` }
  })

  on('tool.call', { tool: 'mcp__notes__notes_write' }, async ($, e) => {
    const a = e as unknown as Record<string, unknown>
    const title = asText(a.tab)?.slice(0, 40)
    if (title === undefined) return { deny: 'tab(탭 이름)이 필요합니다.' }
    const isNew = findTab(await read($, book), title) === undefined

    const b = await change($, isNew ? `에이전트: 새 탭 ${title}` : `에이전트: ${title} 수정`, cur => {
      const old = findTab(cur, title)
      const items: NoteItem[] =
        a.items === undefined
          ? (old?.items ?? [])
          : asList(a.items).map(text => ({ text, isDone: old?.items.find(i => i.text === text)?.isDone ?? false }))
      const tab: NoteTab = {
        title,
        goal: asText(a.goal) ?? old?.goal,
        doneWhen: asText(a.done_when) ?? old?.doneWhen,
        memo: asText(a.memo) ?? old?.memo,
        items: [...items, ...asList(a.add_items).map(text => ({ text, isDone: false }))],
        updatedAt: now(),
      }
      const rest = cur.tabs.filter(t => t.title !== title)
      return { ...cur, tabs: (old ? cur.tabs.map(t => (t.title === title ? tab : t)) : [...rest, tab]).slice(-MAX_TABS), active: title }
    })
    if (isNew) void $.ui.open({ id: PANE, title: 'notes' })

    return ok(describeTab(findTab(b, title)!))
  }).catch(failed)

  on('tool.call', { tool: 'mcp__notes__notes_check' }, async ($, e) => {
    const a = e as unknown as Record<string, unknown>
    const title = asText(a.tab)
    const cur = await read($, book)
    const tab = findTab(cur, title)
    if (tab === undefined) return { deny: `'${title}' 탭이 없습니다. 탭 목록: ${cur.tabs.map(t => t.title).join(', ') || '(없음)'}` }
    const nums = Array.isArray(a.items) ? a.items.filter((n): n is number => Number.isInteger(n)) : []
    const bad = nums.filter(n => n < 1 || n > tab.items.length)
    if (bad.length > 0) return { deny: `없는 단계 번호: ${bad.join(', ')} (1~${tab.items.length})` }
    const isDone = a.done !== false

    const b = await change($, `에이전트: ${tab.title} 체크`, c => ({
      ...c,
      active: tab.title,
      tabs: c.tabs.map(t =>
        t.title !== tab.title
          ? t
          : { ...t, updatedAt: now(), items: t.items.map((i, n) => (nums.includes(n + 1) ? { ...i, isDone } : i)) },
      ),
    }))

    return ok(describeTab(findTab(b, tab.title)!))
  }).catch(failed)

  on('tool.call', { tool: 'mcp__notes__notes_read' }, async ($, e) => {
    const a = e as unknown as Record<string, unknown>
    const b = await read($, book)
    const title = asText(a.tab)
    if (title !== undefined) {
      const tab = findTab(b, title)
      return tab ? ok(describeTab(tab)) : { deny: `'${title}' 탭이 없습니다.` }
    }
    if (b.tabs.length === 0) return ok('노트 탭이 없습니다.')
    return ok(b.tabs.map(describeTab).join('\n\n'))
  }).catch(failed)

  on('tool.call', { tool: 'mcp__notes__notes_close' }, async ($, e) => {
    const title = asText((e as unknown as Record<string, unknown>).tab)
    const cur = await read($, book)
    if (findTab(cur, title) === undefined) return { deny: `'${title}' 탭이 없습니다.` }
    await change($, `에이전트: 탭 지움 ${title}`, c => {
      const tabs = c.tabs.filter(t => t.title !== title)
      return { ...c, tabs, active: c.active === title ? tabs.at(-1)?.title : c.active }
    })
    return ok(`'${title}' 탭을 지웠습니다.`)
  }).catch(failed)

  // 창을 움직이지 않고 본문 안의 위치만 줄 단위로 옮긴다(탭 줄 고정). 휠 한 칸 = 한 줄, Claude Code 기본과 같다.
  // 키보드(방향키·페이지 키)로는 본문을 움직이지 않는다. 휠만 쓴다. 방향키는 초점 이동에만 쓰인다.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person' && e.pointer === undefined) return {}
    const by = Number.isFinite(e.by) ? e.by : 0
    await update($, scroll, s => Math.min(Math.max(0, s + by), maxScroll))
    // 창은 맨 위에 둔다: 탭 줄이 항상 보이게.
    return next({ ...e, offset: 0 })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const b = await read($, book)
    const tab = findTab(b, b.active) ?? b.tabs.at(-1)
    const last = b.history.at(-1)

    const nextUp = (b.future ?? []).at(-1)
    const short = (label: string) => (label.length > 16 ? `${label.slice(0, 16)}…` : label)
    const undoText = last && `↶ 되돌리기: ${short(last.label)}`
    const redoText = nextUp && `↷ 앞으로: ${short(nextUp.label)}`
    const undoButton = undoText && (
      <Button key="undo" onPress={() => void undo($)}>
        {undoText}
      </Button>
    )
    const redoButton = redoText && (
      <Button key="redo" onPress={() => void redo($)}>
        {redoText}
      </Button>
    )

    if (tab === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>아직 노트가 없습니다. 에이전트가 계획을 세우면 여기에 탭이 생깁니다.</Text>
          {(undoButton || redoButton) && buttonBar(Box, [undoButton, redoButton])}
        </Box>
      )
    }

    const done = tab.items.filter(i => i.isDone).length
    const select = (title: string) => () =>
      void update($, book, c => ({ ...c, active: title })).then(() => update($, scroll, () => 0))
    const toggle = (n: number) => () =>
      void change($, `${tab.title} #${n + 1} 체크`, c => ({
        ...c,
        tabs: c.tabs.map(t =>
          t.title !== tab.title ? t : { ...t, updatedAt: now(), items: t.items.map((i, k) => (k === n ? { ...i, isDone: !i.isDone } : i)) },
        ),
      }))
    const remove = () =>
      void change($, `탭 지움: ${tab.title}`, c => {
        const tabs = c.tabs.filter(t => t.title !== tab.title)
        return { ...c, tabs, active: tabs.at(-1)?.title }
      })

    // 탭 줄만 고정한다. 창 자체는 움직이지 않고, 스크롤하면 본문의 앞쪽 묶음(블록)을 건너뛰어 그린다.
    // 창에 다 안 들어가면 들어가는 묶음까지만 그리고 마지막 줄에 [▼ 아래로] 를 둔다(창 밖·상태 줄로 넘치지 않게).
    // 구역마다 제목 줄을 두고 빈 줄로 나눈다: 목표·종료 조건 / 할 일 / 메모. 메모는 체크 칸 없이 흐린 글자로 단계와 구별한다.
    const cols = Math.max(10, e.props.bodyColumns - 2)
    const section = (key: string, label: string, color: string, body: RenderChildren) => (
      <Box key={key} flexDirection="column" marginTop={1}>
        <Text bold color={color}>
          {label}
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          {body}
        </Box>
      </Box>
    )
    const memoLines = tab.memo?.split('\n') ?? []
    // 묶음마다 그릴 것과 차지할 줄 수(대략)를 함께 둔다.
    const blocks: { el: RenderChildren; rows: number }[] = [
      {
        el: (
          <Text key="b-title" bold>
            {tab.title} ({done}/{tab.items.length})
          </Text>
        ),
        rows: textRows(`${tab.title} (${done}/${tab.items.length})`, cols),
      },
      tab.goal ? { el: section('b-goal', '목표', 'cyan', <Text>{tab.goal}</Text>), rows: 2 + textRows(tab.goal, cols - 2) } : undefined,
      tab.doneWhen
        ? { el: section('b-doneWhen', '종료 조건', 'yellow', <Text>{tab.doneWhen}</Text>), rows: 2 + textRows(tab.doneWhen, cols - 2) }
        : undefined,
      {
        el: (
          <Box key="b-items" marginTop={1}>
            <Text bold color="green">
              할 일
            </Text>
          </Box>
        ),
        rows: 2,
      },
      ...tab.items.map((i, n) => ({
        // 줄 어디를 눌러도 체크가 바뀐다.
        el: (
          <Box key={`item-${n}`} paddingLeft={2}>
            <Button key={`chk-${n}`} label={i.text} plain onPress={toggle(n)}>
              {i.isDone ? '☑ ' : '☐ '}
              <Text strikethrough={i.isDone} dimColor={i.isDone}>
                {i.text}
              </Text>
            </Button>
          </Box>
        ),
        rows: textRows(`☐ ${i.text}`, cols - 2),
      })),
      memoLines.length > 0
        ? {
            el: section(
              'b-memo',
              '메모',
              'magenta',
              memoLines.map((line, n) => (
                <Text key={`memo-${n}`} dimColor>
                  {line}
                </Text>
              )),
            ),
            rows: 2 + memoLines.reduce((sum, line) => sum + textRows(line, cols - 2), 0),
          }
        : undefined,
    ].filter((x): x is { el: RenderChildren; rows: number } => x !== undefined)
    // 아래 버튼 줄([탭 지우기]·[되돌리기])은 본문과 따로 창 맨 아래에 고정한다.
    const bar = buttonBar(Box, [
      <Button key="remove" onPress={remove}>
        탭 지우기
      </Button>,
      undoButton,
      redoButton,
    ])
    const barRows = 2 + textRows(`[ 탭 지우기 ] [ ${undoText ?? ''} ] [ ${redoText ?? ''} ]`, cols - 2)
    // 창 높이에서 탭 줄(테두리 2줄 + 접힌 줄 수)·버튼 줄·여유 한 줄을 빼고 남은 만큼이 본문 자리다.
    const tabWidth = b.tabs.reduce((w, t) => w + cellWidth(t.title) + 6, 0)
    const tabRows = 2 + Math.max(1, Math.ceil(tabWidth / cols))
    const avail = e.props.scroll.bodyRows - tabRows - barRows - 1
    const total = blocks.reduce((sum, x) => sum + x.rows, 0)
    // 다 들어가면 그대로 그린다.
    // 안 들어가면 [▲ 위로] 줄·[▼ 아래로] 줄을 늘 남기고(자리가 들썩이지 않게), 그 사이 창에서
    // 본문 전체를 위로 off 줄만큼 밀어 올려 보여 준다. 줄 수는 어림이라 끝에 한 줄 여유를 더 둔다.
    const room = Math.max(1, avail - 2)
    const isScrollable = total > avail
    maxScroll = isScrollable ? total - room + 1 : 0
    const off = Math.min(Math.max(0, await read($, scroll)), maxScroll)
    const page = Math.max(1, room - 1)
    const up = () => void update($, scroll, s => Math.max(0, Math.min(s, maxScroll) - page))
    const down = () => void update($, scroll, s => Math.min(maxScroll, s + page))
    // 위·아래 표시: 기울인 글자에 배경색을 칠해 본문과 구별한다. 없을 때도 빈 줄로 자리를 지킨다.
    const pager = (key: string, text: string | undefined, onPress: () => void) => (
      <Box key={`${key}-row`} flexDirection="row" justifyContent="center">
        {text === undefined ? (
          <Text> </Text>
        ) : (
          <Button key={key} label={text} plain onPress={onPress}>
            <Text italic backgroundColor="gray">
              {` ${text} `}
            </Text>
          </Button>
        )}
      </Box>
    )
    const body = blocks.map(x => x.el)

    // 옆에 붙은 창(dock)은 창 높이를 꽉 채워 버튼 줄이 늘 맨 아래에 오게 한다. 프롬프트 위 창(inline)은 내용 높이만큼.
    const isDock = e.props.placement === 'dock'
    return (
      <Box flexDirection="column" height={isDock ? e.props.scroll.bodyRows - 1 : undefined}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          {b.tabs.map(t => (
            <Button key={`tab-${t.title}`} variant={t.title === tab.title ? 'primary' : 'secondary'} dimColor={t.title !== tab.title} onPress={select(t.title)}>
              {t.title === tab.title ? `▶ ${t.title}` : t.title}
            </Button>
          ))}
        </Box>
        <Box key="body" flexDirection="column" flexGrow={1}>
          {isScrollable ? (
            <Box flexDirection="column">
              {pager('scroll-up', off > 0 ? `▲ 위로 (${off}줄)` : undefined, up)}
              <Box key="viewport" flexDirection="column" height={room} overflow="hidden">
                <Box key="viewport-body" flexDirection="column" marginTop={-off}>
                  {body}
                </Box>
              </Box>
              {pager('scroll-down', off < maxScroll ? `▼ 아래로 (${maxScroll - off}줄)` : undefined, down)}
            </Box>
          ) : (
            body
          )}
        </Box>
        {bar}
      </Box>
    )
  })
}
