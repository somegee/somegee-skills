import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { NoteChange, NoteChangePart, NoteDraft, NoteItem, NotesBook, NoteTab } from '../types'

const PANE = 'notes'
const MAX_TABS = 30
const MAX_HISTORY = 20
const book = atom({ plugin: 'notes', key: 'book' } as const, { root: '', tabs: [], history: [] } as NotesBook)
const scroll = atom({ plugin: 'notes', key: 'scroll' } as const, 0)
const draft = atom({ plugin: 'notes', key: 'draft' } as const, null as NoteDraft | null)

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

type Saved = { tabs: NoteTab[]; history: NoteChange[] }

async function loadFile($: EngineInterface, root: string): Promise<Saved> {
  try {
    const saved = JSON.parse(await $.fs.read(dataPath($, root))) as Partial<Saved>
    return { tabs: Array.isArray(saved.tabs) ? saved.tabs : [], history: Array.isArray(saved.history) ? saved.history : [] }
  } catch {
    return { tabs: [], history: [] }
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
// label 은 되돌리기 버튼에 보일 설명이다.
async function change($: EngineInterface, label: string, fn: (b: NotesBook) => NotesBook) {
  const { root } = await read($, book)
  const saved = await loadFile($, root)
  const next = await update($, book, cur => fn({ ...cur, ...saved }))
  const parts = diffTabs(saved.tabs, next.tabs)
  if (parts.length === 0) return next
  const history = [...saved.history, { label, at: now(), parts }].slice(-MAX_HISTORY)
  await save($, root, { tabs: next.tabs, history })
  return update($, book, c => ({ ...c, history }))
}

// 가장 최근 변경 하나를 되돌린다.
async function undo($: EngineInterface) {
  const { root } = await read($, book)
  const saved = await loadFile($, root)
  const last = saved.history.at(-1)
  if (last === undefined) return
  const tabs = revert(saved.tabs, last)
  const history = saved.history.slice(0, -1)
  await save($, root, { tabs, history })
  await update($, book, c => ({ ...c, tabs, history, active: tabs.some(t => t.title === c.active) ? c.active : tabs.at(-1)?.title }))
}

// 다른 세션의 변경을 이 세션 화면에 반영한다.
async function sync($: EngineInterface) {
  const cur = await read($, book)
  const saved = await loadFile($, cur.root)
  if (JSON.stringify(saved) === JSON.stringify({ tabs: cur.tabs, history: cur.history })) return
  await update($, book, c => ({ ...c, ...saved, active: saved.tabs.some(t => t.title === c.active) ? c.active : saved.tabs.at(-1)?.title }))
}

// 하단 버튼 줄: 상단 탭 줄과 같은 둥근 테두리 상자.
const buttonBar = (Box: ElementConstructor<BoxProps>, buttons: RenderChildren[]) => (
  <Box flexDirection="row" flexWrap="wrap" columnGap={1} borderStyle="round" borderColor="gray" paddingX={1}>
    {buttons.filter(Boolean)}
  </Box>
)

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

  // 보기 화면에서는 창을 움직이지 않고 본문 안의 위치만 옮긴다(탭 줄·버튼 줄 고정). 편집 화면은 창이 그대로 스크롤한다.
  // 키보드(방향키·페이지 키)로는 본문을 움직이지 않는다. 휠만 쓴다. 방향키는 초점 이동에만 쓰인다.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if ((await read($, draft)) !== null) return next(e)
    if (e.origin.kind === 'person' && e.pointer === undefined) return {}
    const b = await read($, book)
    const tab = findTab(b, b.active) ?? b.tabs.at(-1)
    const most = (tab?.items.length ?? 0) + 5
    // 휠 한 칸 = 본문 한 묶음. 크게 움직이면(페이지 키 등) 두 줄에 한 묶음꼴로 넘긴다.
    const by = Number.isFinite(e.by) && e.by !== 0 ? e.by : e.offset
    const step = Math.sign(by) * Math.max(1, Math.round(Math.abs(by) / 2))
    await update($, scroll, s => Math.min(Math.max(0, s + (Number.isFinite(step) ? step : 0)), most))
    // 창은 맨 위에 둔다: 탭 줄이 항상 보이게.
    return next({ ...e, offset: 0 })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // 모바일에는 입력 칸이 없어 편집 모드를 보여 주지 않는다.
    const Input = 'Input' in els ? els.Input : undefined
    const b = await read($, book)
    const d = await read($, draft)
    const tab = findTab(b, b.active) ?? b.tabs.at(-1)
    const last = b.history.at(-1)

    const undoButton = last && (
      <Button key="undo" onPress={() => void undo($)}>
        {`↶ 되돌리기: ${last.label.length > 24 ? `${last.label.slice(0, 24)}…` : last.label}`}
      </Button>
    )

    // 편집 중: 입력은 초안에만 담고, [저장] 을 눌렀을 때만 한 번에 반영한다. 문구 칸의 Enter 는 저장하지 않는다.
    if (d && Input) {
      const setDraft = (fn: (x: NoteDraft) => NoteDraft) => void update($, draft, x => (x ? fn(x) : x))
      const withField = (key: 'title' | 'goal' | 'doneWhen' | 'memo', v: string) => (x: NoteDraft) => ({ ...x, [key]: v })
      const withItem = (n: number, v: string) => (x: NoteDraft) => ({
        ...x,
        items: x.items.map((i, k) => (k === n ? { ...i, text: v } : i)),
      })
      const field = (key: 'title' | 'goal' | 'doneWhen' | 'memo') => (v: string) => setDraft(withField(key, v))
      const itemText = (n: number) => (v: string) => setDraft(withItem(n, v))
      const addItem = (v: string) => {
        if (v.trim() !== '') setDraft(x => ({ ...x, items: [...x.items, { text: v.trim(), isDone: false }] }))
      }
      const cancel = () => void update($, draft, () => null)
      // 그린 시점의 초안이 아니라 지금 상태의 초안을 읽어 저장한다.
      const commit = async () => {
        const cur = await read($, draft)
        if (cur === null) return
        const { origTitle, ...edited } = cur
        const wanted = edited.title.trim().slice(0, 40)
        await change($, `직접 편집: ${origTitle}`, c => {
          const title = wanted !== '' && (wanted === origTitle || !c.tabs.some(t => t.title === wanted)) ? wanted : origTitle
          const tab: NoteTab = {
            title,
            goal: asText(edited.goal),
            doneWhen: asText(edited.doneWhen),
            memo: asText(edited.memo),
            items: edited.items.filter(i => i.text.trim() !== '').map(i => ({ ...i, text: i.text.trim() })),
            updatedAt: now(),
          }
          const exists = c.tabs.some(t => t.title === origTitle)
          return { ...c, tabs: exists ? c.tabs.map(t => (t.title === origTitle ? tab : t)) : [...c.tabs, tab], active: title }
        })
        await update($, draft, () => null)
      }

      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>✎ 편집 중: {d.origTitle}</Text>
          <Text dimColor>맨 아래 [저장] 을 눌러야 저장됩니다. [취소] = 저장 안 함. 단계 문구를 비우고 저장하면 그 단계가 빠집니다.</Text>
          <Box flexDirection="column">
            <Input key="edit-title" label="탭 이름" value={d.title} submitLabel="확인" onInput={field('title')} onSubmit={field('title')} />
            <Input key="edit-goal" label="목표" value={d.goal ?? ''} submitLabel="확인" onInput={field('goal')} onSubmit={field('goal')} />
            <Input key="edit-doneWhen" label="종료 조건" value={d.doneWhen ?? ''} submitLabel="확인" onInput={field('doneWhen')} onSubmit={field('doneWhen')} />
          </Box>
          <Box flexDirection="column">
            {d.items.map((i, n) => (
              <Input key={`edit-item-${n}`} label="•" value={i.text} submitLabel="확인" onInput={itemText(n)} onSubmit={itemText(n)} />
            ))}
            <Input key="edit-add" label="+" placeholder="새 단계 입력 후 Enter" submitLabel="추가" value="" onSubmit={addItem} />
          </Box>
          <Input key="edit-memo" label="메모" value={d.memo ?? ''} submitLabel="확인" onInput={field('memo')} onSubmit={field('memo')} />
          {buttonBar(Box, [
            <Button key="edit-save" variant="primary" onPress={() => void commit()}>
              저장
            </Button>,
            <Button key="edit-cancel" role="dismiss" onPress={cancel}>
              취소
            </Button>,
          ])}
        </Box>
      )
    }

    if (tab === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>아직 노트가 없습니다. 에이전트가 계획을 세우면 여기에 탭이 생깁니다.</Text>
          {undoButton && buttonBar(Box, [undoButton])}
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
    const startEdit = () => void update($, draft, () => ({ ...tab, origTitle: tab.title }))

    // 탭 줄만 고정한다. 창 자체는 움직이지 않고, 스크롤하면 본문의 앞쪽 묶음(블록)을 건너뛰어 그린다.
    // 아래쪽은 창 높이만큼 보이고 넘치는 부분은 잘린다(스크롤하면 올라온다).
    const blocks: RenderChildren[] = [
      <Text key="b-title" bold>
        {tab.title} ({done}/{tab.items.length})
      </Text>,
      tab.goal && <Text key="b-goal">목표: {tab.goal}</Text>,
      tab.doneWhen && (
        <Text key="b-doneWhen" color="yellow">
          종료 조건: {tab.doneWhen}
        </Text>
      ),
      ...tab.items.map((i, n) => (
        // 줄 어디를 눌러도 체크가 바뀐다.
        <Button key={`chk-${n}`} label={i.text} plain onPress={toggle(n)}>
          {i.isDone ? '☑ ' : '☐ '}
          <Text strikethrough={i.isDone} dimColor={i.isDone}>
            {i.text}
          </Text>
        </Button>
      )),
      tab.memo && (
        <Text key="b-memo" dimColor>
          메모: {tab.memo}
        </Text>
      ),
      buttonBar(Box, [
        Input && (
          <Button key="edit" onPress={startEdit}>
            ✎ 편집
          </Button>
        ),
        <Button key="remove" onPress={remove}>
          탭 지우기
        </Button>,
        undoButton,
      ]),
    ].filter(Boolean)
    const start = Math.min(Math.max(0, await read($, scroll)), blocks.length - 1)
    const up = () => void update($, scroll, s => Math.max(0, Math.min(s, blocks.length - 1) - 3))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          {b.tabs.map(t => (
            <Button key={`tab-${t.title}`} variant={t.title === tab.title ? 'primary' : 'secondary'} dimColor={t.title !== tab.title} onPress={select(t.title)}>
              {t.title === tab.title ? `▶ ${t.title}` : t.title}
            </Button>
          ))}
        </Box>
        {start > 0 && (
          <Box flexDirection="row" justifyContent="center">
            <Button key="scroll-up" plain onPress={up}>
              {`▲ 위로 (${start})`}
            </Button>
          </Box>
        )}
        {blocks.slice(start)}
      </Box>
    )
  })
}
