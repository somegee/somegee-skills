import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, RenderChildren } from 'claude-code'

import { callSummary, toCallDisplay } from './call-summary'
import type { NoteChange, NoteChangePart, NoteItem, NoteItemStatus, NotesBook, NoteSession, NoteTab } from '../types'

const PANE = 'notes'
const MAX_TABS = 30
const MAX_HISTORY = 20
const book = atom({ plugin: 'notes', key: 'book' } as const, { root: '', tabs: [], history: [], future: [] } as NotesBook)
const scroll = atom({ plugin: 'notes', key: 'scroll' } as const, 0)
const tick = atom({ plugin: 'notes', key: 'tick' } as const, 0)
// 접어 둔 구역. 키 = '<탭 이름>|<구역>'. 이 세션에서만 유지된다(다른 세션·파일과 공유하지 않음).
const folded = atom({ plugin: 'notes', key: 'folded' } as const, {} as Record<string, boolean>)

const SYNC_MS = 3000
// 'N분 전 갱신' 이 흐르도록 다시 그리는 간격.
const TICK_MS = 30000
// 지금 하는 단계의 배경색(고정).
const CURRENT_BG = '#2e6b3f'
// 터미널 옆 창 왼쪽 여백(칸).
const PANE_GUTTER = 1
// 결과물 문구에서 링크로 만들 주소.
const URL_RE = /https?:\/\/[^\s)>\]]+/

// 이 세션의 id 와 이름. 이름은 /rename 한 것, 없으면 Claude Code 가 붙인 제목.
// 공식 API 가 없어 Claude Code 가 남기는 파일을 읽는다(형식이 바뀌면 세션 번호로 보인다). $.fs.read 는 4MB 까지라
// 작은 파일부터 본다: ① <기록 폴더>/<id>/custom-title.json ② <.claude>/sessions/*.json 의 name ③ 기록(.jsonl)의 마지막 제목 줄.
let sessionId = ''
let sessionTitle: string | undefined
let transcriptPath: string | undefined
const sessionTag = (): NoteSession => ({ id: sessionId, title: sessionTitle })
const lastTitle = (text: string, field: 'customTitle' | 'aiTitle') => {
  const re = new RegExp(`"${field}":"((?:[^"\\\\]|\\\\.)*)"`, 'g')
  let found: string | undefined
  for (const m of text.matchAll(re)) found = m[1]
  if (found === undefined) return undefined
  try {
    return (JSON.parse(`"${found}"`) as string).trim() || undefined
  } catch {
    return found
  }
}
const readText = async ($: EngineInterface, path: string) => {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}
// ① rename 한 이름: 기록 파일 옆 <id>/custom-title.json
async function customTitle($: EngineInterface, transcript: string) {
  const text = await readText($, `${transcript.replace(/\.jsonl$/, '')}/custom-title.json`)
  return text === undefined ? undefined : lastTitle(text, 'customTitle')
}
// ② 실행 중인 세션 목록(<.claude>/sessions/<pid>.json)에서 이 세션의 name
async function listedName($: EngineInterface, claudeDir: string) {
  try {
    for (const f of await $.fs.list(`${claudeDir}/sessions`)) {
      if (!f.name.endsWith('.json')) continue
      const text = await readText($, `${claudeDir}/sessions/${f.name}`)
      if (text === undefined || !text.includes(sessionId)) continue
      const name = (JSON.parse(text) as { sessionId?: string; name?: unknown }).name
      if (typeof name === 'string' && name.trim() !== '') return name.trim()
    }
  } catch {
    // 목록을 못 읽으면 다음 방법으로.
  }
  return undefined
}
// 기록 파일 위치: classic 훅이 준 경로, 없으면 <.claude>/projects/<작업 폴더를 - 로 바꾼 이름>/<세션 id>.jsonl
// isQuick: 3초마다 부를 때는 작은 파일(①②)만 본다. 큰 기록 파일(③)은 시작·프롬프트·30초마다.
async function refreshTitle($: EngineInterface, isQuick = false) {
  const claudeDir = $.plugin.root.match(/^(.*?[\\/]\.claude)[\\/]/)?.[1]
  const transcript =
    transcriptPath ?? (claudeDir && sessionId ? `${claudeDir}/projects/${(await $.session.root()).replace(/[^A-Za-z0-9]/g, '-')}/${sessionId}.jsonl` : undefined)
  let title = transcript === undefined ? undefined : await customTitle($, transcript)
  if (title === undefined && claudeDir && sessionId) title = await listedName($, claudeDir)
  if (title === undefined && transcript !== undefined && !isQuick) {
    // ③ 기록이 4MB 를 넘으면 읽지 못한다(그때는 세션 번호로 보인다).
    const text = await readText($, transcript)
    if (text !== undefined) title = lastTitle(text, 'customTitle') ?? lastTitle(text, 'aiTitle')
  }
  if (title === undefined || title === sessionTitle) return
  sessionTitle = title
  // 이 세션이 다룬 탭의 이름표도 새 이름으로(파일엔 다음 변경 때 저장된다). 화면은 다시 그리게 한다.
  await update($, book, b => ({ ...b, tabs: b.tabs.map(t => (t.session?.id === sessionId ? { ...t, session: sessionTag() } : t)) }))
}
const sessionLabel = (s: NoteSession | undefined) =>
  (s?.id !== undefined && s.id === sessionId ? sessionTitle : undefined) ?? s?.title ?? (s?.id ? `세션 ${s.id.slice(0, 8)}` : undefined)

// 마지막 갱신이 지금부터 얼마 전인지 사람 말로.
const ago = (iso: string, nowMs: number) => {
  const sec = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (!Number.isFinite(sec) || sec < 60) return '방금'
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`
  return `${Math.floor(sec / 86400)}일 전`
}

const STATUS_MARK: Record<NoteItemStatus, string> = { blocked: '⛔ 막힘', waiting: '⏳ 대기' }
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
  t.items.forEach((i, n) => {
    lines.push(`#${n + 1} [${i.isDone ? 'x' : ' '}] ${i.text}`)
    if (i.status) lines.push(`    ${STATUS_MARK[i.status]}${i.note ? `: ${i.note}` : ''}`)
    if (i.resolved) lines.push(`    ↳ 해결: ${i.resolved}`)
  })
  if (t.results?.length) lines.push(`결과물: ${t.results.join(' / ')}`)
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
// 노트는 사람이 보는 메인 에이전트만 쓴다. 서브에이전트·팀원 루프에서 부르면 거절한다.
const MAIN_ONLY = { deny: 'notes 는 메인 에이전트만 씁니다. 진행 상황은 결과로 메인 에이전트에게 돌려주세요.' }

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
  '- 단계가 막히거나(권한·오류 등) 사용자·외부 답을 기다리게 되면 notes_status 로 그 단계에 blocked / waiting 과 사유(note)를 단다. 사용자가 풀어 주거나 답이 오면 status: clear 와 처리 내역(note)을 남긴다. 그 내역은 해당 단계 바로 아래에 보인다.',
  '- 커밋·PR·파일 경로·링크처럼 작업 결과물이 생기면 add_results 로 결과물 칸에 모은다. 메모에 섞지 않는다.',
  '- 창은 단계에 번호를 붙이지 않는다. 순서가 중요하면 문구 앞에 번호를 직접 붙인다(예: "1. ...", 하위 단계는 "1-1. ..."). 결정·질문 같은 단계에는 번호 대신 [결정] 같은 머리표를 써도 된다. 번호를 쓰면 탭 안에서 빠지거나 겹치지 않게 1부터 차례로 맞춘다.',
  '- notes_read 결과의 #N 은 위치 번호(notes_check 에 넘기는 값)이고 문구 속 번호와 다를 수 있다.',
  '- 사용자가 다른 주제로 넘어가면 기존 탭은 그대로 두고 새 탭을 만든다.',
  '- 사용자가 "아까 거 어디까지 했지" 처럼 이전 작업을 물으면 먼저 notes_read 로 확인하고 답한다.',
  '- 탭 삭제(notes_close)는 사용자가 정리를 원할 때만 한다.',
  '- 서브에이전트는 notes 도구를 쓰지 않는다. 노트는 메인 에이전트만 고친다.',
].join('\n')

export const register: Register = (on, options) => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // 헤드리스(-p·SDK)는 그릴 곳이 없다. 보는 사람이 없으니 규칙을 넣지 않는다.
    if (e.surfaces.length === 0) return composed
    return { sections: [...composed.sections, { id: 'notes:guide', text: GUIDE, scope: 'session' }] }
  })

  // 세션 이름은 classic 훅 입력의 session_title 로만 알 수 있다. 시작할 때와 프롬프트마다 갱신한다(/rename 반영).
  // classic 훅은 기록 파일 경로를 준다. 시작할 때와 프롬프트를 보낼 때마다 이름을 다시 읽는다(/rename 반영).
  on('classic.SessionStart', async ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') transcriptPath = e.transcript_path
    await refreshTitle($)
    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') transcriptPath = e.transcript_path
    await refreshTitle($)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    // 헤드리스(크론·-p·SDK)는 볼 사람이 없다. 도구를 등록하지 않아 노트 파일에 쓰지 못하게 한다.
    if (!e.isInteractive) return next(e)
    const root = await $.session.root()
    sessionId = await $.session.id()
    const saved = await loadFile($, root)
    await update($, book, () => ({ root, ...saved, active: saved.tabs.at(-1)?.title }))
    // 3초마다: 다른 세션이 고친 노트 반영 + /rename 한 이름 반영.
    $.clock.every(SYNC_MS, () => void sync($).then(() => refreshTitle($, true)))
    $.clock.every(TICK_MS, () => void update($, tick, n => (n + 1) % 100000).then(() => refreshTitle($)))
    void refreshTitle($)
    // 기본은 세션을 열면 창도 연다. /config 의 notes.autoOpen 을 끄면 /notes 로만 연다.
    if (options.autoOpen !== false && e.isInteractive) void $.ui.open({ id: PANE, title: 'notes' })

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
          results: { type: 'array', items: { type: 'string' }, description: '결과물 목록 전체(커밋·PR·파일 경로·링크 등)' },
          add_results: { type: 'array', items: { type: 'string' }, description: '결과물 칸 끝에 덧붙일 것' },
        },
        required: ['tab'],
      },
    })
    await $.tool.register({
      name: 'notes_status',
      isDeferred: false,
      description:
        '단계에 막힘(blocked)·대기(waiting) 표시와 사유를 달거나, 풀렸을 때 status: clear 와 처리 내역을 남긴다(단계 바로 아래에 보임). ' +
        'item 은 notes_read 결과의 #N 위치 번호(1부터).',
      inputSchema: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          item: { type: 'integer', description: '위치 번호 #N (1부터)' },
          status: { type: 'string', enum: ['blocked', 'waiting', 'clear'], description: 'blocked=막힘, waiting=대기, clear=풀림' },
          note: { type: 'string', description: 'blocked/waiting 이면 사유, clear 면 어떻게 풀었는지' },
        },
        required: ['tab', 'item', 'status'],
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
    if (e.agentId !== undefined) return MAIN_ONLY
    const a = e as unknown as Record<string, unknown>
    const title = asText(a.tab)?.slice(0, 40)
    if (title === undefined) return { deny: 'tab(탭 이름)이 필요합니다.' }
    const isNew = findTab(await read($, book), title) === undefined

    const b = await change($, isNew ? `에이전트: 새 탭 ${title}` : `에이전트: ${title} 수정`, cur => {
      const old = findTab(cur, title)
      // 같은 문구의 단계는 체크·막힘·처리 내역을 그대로 이어 간다.
      const items: NoteItem[] =
        a.items === undefined
          ? (old?.items ?? [])
          : asList(a.items).map(text => old?.items.find(i => i.text === text) ?? { text, isDone: false })
      const results = a.results === undefined ? (old?.results ?? []) : asList(a.results)
      const tab: NoteTab = {
        title,
        goal: asText(a.goal) ?? old?.goal,
        doneWhen: asText(a.done_when) ?? old?.doneWhen,
        memo: asText(a.memo) ?? old?.memo,
        items: [...items, ...asList(a.add_items).map(text => ({ text, isDone: false }))],
        results: [...results, ...asList(a.add_results)],
        session: sessionTag(),
        updatedAt: now(),
      }
      const rest = cur.tabs.filter(t => t.title !== title)
      return { ...cur, tabs: (old ? cur.tabs.map(t => (t.title === title ? tab : t)) : [...rest, tab]).slice(-MAX_TABS), active: title }
    })
    if (isNew) void $.ui.open({ id: PANE, title: 'notes' })

    return ok(describeTab(findTab(b, title)!))
  }).catch(failed)

  on('tool.call', { tool: 'mcp__notes__notes_check' }, async ($, e) => {
    if (e.agentId !== undefined) return MAIN_ONLY
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
          : { ...t, session: sessionTag(), updatedAt: now(), items: t.items.map((i, n) => (nums.includes(n + 1) ? { ...i, isDone } : i)) },
      ),
    }))

    return ok(describeTab(findTab(b, tab.title)!))
  }).catch(failed)

  on('tool.call', { tool: 'mcp__notes__notes_status' }, async ($, e) => {
    if (e.agentId !== undefined) return MAIN_ONLY
    const a = e as unknown as Record<string, unknown>
    const title = asText(a.tab)
    const cur = await read($, book)
    const tab = findTab(cur, title)
    if (tab === undefined) return { deny: `'${title}' 탭이 없습니다. 탭 목록: ${cur.tabs.map(t => t.title).join(', ') || '(없음)'}` }
    const n = Number.isInteger(a.item) ? (a.item as number) : 0
    if (n < 1 || n > tab.items.length) return { deny: `없는 단계 번호: ${String(a.item)} (1~${tab.items.length})` }
    const status = a.status
    if (status !== 'blocked' && status !== 'waiting' && status !== 'clear') return { deny: 'status 는 blocked, waiting, clear 중 하나입니다.' }
    const note = asText(a.note)
    const apply = (i: NoteItem): NoteItem => {
      if (status === 'clear') {
        const { status: _s, note: _n, ...rest } = i
        return { ...rest, resolved: note ?? i.resolved ?? '해결됨' }
      }
      return { ...i, status, note, resolved: undefined }
    }
    const label = status === 'clear' ? `에이전트: #${n} 풀림` : `에이전트: #${n} ${status === 'blocked' ? '막힘' : '대기'}`
    const b = await change($, label, c => ({
      ...c,
      active: tab.title,
      tabs: c.tabs.map(t =>
        t.title !== tab.title ? t : { ...t, session: sessionTag(), updatedAt: now(), items: t.items.map((i, k) => (k === n - 1 ? apply(i) : i)) },
      ),
    }))
    return ok(describeTab(findTab(b, tab.title)!))
  }).catch(failed)

  on('tool.call', { tool: 'mcp__notes__notes_read' }, async ($, e) => {
    if (e.agentId !== undefined) return MAIN_ONLY
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
    if (e.agentId !== undefined) return MAIN_ONLY
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
  // 직접 스크롤은 터미널이 본문을 넘치게 그렸을 때만(maxScroll > 0). 데스크톱 등은 창이 스스로 스크롤하게 그대로 넘긴다.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (maxScroll === 0) return next(e)
    if (e.origin.kind === 'person' && e.pointer === undefined) return {}
    const by = Number.isFinite(e.by) ? e.by : 0
    await update($, scroll, s => Math.min(Math.max(0, s + by), maxScroll))
    // 창은 맨 위에 둔다: 탭 줄이 항상 보이게.
    return next({ ...e, offset: 0 })
  })

  // 대화창의 notes 도구 호출 줄. 설정 callDisplay: 요약(기본, 한 줄) / 숨김 / 원래대로(엔진이 그리던 대로).
  // 결과 칸(탭 전체 내용)은 요약·숨김일 때 비운다. 에이전트가 받는 결과는 그대로다(화면만 바뀜).
  const callDisplay = toCallDisplay(options.callDisplay)
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    const summary = callSummary(e.props.tool, e.props.input)
    if (summary === undefined || callDisplay === '원래대로') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (callDisplay === '숨김') return <Box key="notes-hidden" />
    const { isRunning, isErrored, isInterrupted } = e.props
    const tail = isErrored ? ' · 실패' : isInterrupted ? ' · 중단됨' : isRunning ? ' …' : ''
    return (
      <Box key="notes-call">
        <Text dimColor={!isErrored} color={isErrored ? 'red' : undefined}>
          {`${summary}${tail}`}
        </Text>
      </Box>
    )
  })
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (callSummary(e.props.tool, undefined) === undefined || callDisplay === '원래대로') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box key="notes-result" />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Markdown } = $.ui.resolve(e)
    // 데스크톱 등은 목표·종료 조건·결과물·메모를 Markdown 으로 그려 드래그로 고를 수 있게 한다. 터미널은 Text.
    const isRich = e.surface !== 'terminal'
    // 터미널 옆 창은 왼쪽 구분선(│)에 글자가 붙지 않게 한 칸 띄운다. 데스크톱 등은 구분선이 없어 그대로.
    const gutter = e.surface === 'terminal' ? PANE_GUTTER : 0
    const md = (key: string, text: string, dim = false) => <Markdown key={key} text={text} dimColor={dim} />
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
        <Box key="pane-root" flexDirection="column" paddingLeft={gutter}>
          <Text dimColor>아직 노트가 없습니다. 에이전트가 계획을 세우면 여기에 탭이 생깁니다.</Text>
          {(undoButton || redoButton) && buttonBar(Box, [undoButton, redoButton])}
        </Box>
      )
    }

    const done = tab.items.filter(i => i.isDone).length
    // 지금 하는 단계 = 아직 안 끝난 첫 단계. tick 을 읽어 두면 일정 간격으로 다시 그려져 갱신 시각이 흐른다.
    await read($, tick)
    const current = tab.items.findIndex(i => !i.isDone)
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

    // 구역마다 제목 줄을 두고 빈 줄로 나눈다: 목표·종료 조건 / 할 일 / 결과물 / 메모. 메모는 체크 칸 없이 흐린 글자로 단계와 구별한다.
    const cols = Math.max(10, e.props.bodyColumns - 2 - gutter)
    // 구역 제목을 누르면 접고 편다. 접으면 제목 줄에 요약(개수 등)만 남는다.
    const foldMap = await read($, folded)
    const isFolded = (id: string) => foldMap[`${tab.title}|${id}`] === true
    const toggleFold = (id: string) => () =>
      void update($, folded, m => ({ ...m, [`${tab.title}|${id}`]: !m[`${tab.title}|${id}`] }))
    const header = (id: string, label: string, color: string, summary = '') => (
      <Button key={`fold-${id}`} label={`${isFolded(id) ? '▸' : '▾'} ${label}${summary ? ` ${summary}` : ''}`} plain onPress={toggleFold(id)}>
        <Text bold color={color}>
          {`${isFolded(id) ? '▸' : '▾'} ${label}`}
        </Text>
        {summary !== '' && <Text dimColor>{` ${summary}`}</Text>}
      </Button>
    )
    const section = (key: string, label: string, color: string, body: RenderChildren, summary = '') => {
      const id = key.replace(/^b-/, '')
      return (
        <Box key={key} flexDirection="column" marginTop={1}>
          {header(id, label, color, summary)}
          {!isFolded(id) && (
            <Box flexDirection="column" paddingLeft={2}>
              {body}
            </Box>
          )}
        </Box>
      )
    }
    // 접힌 구역은 제목 줄(빈 줄 포함 2줄)만 차지한다.
    const sectionRows = (key: string, bodyRows: number) => 2 + (isFolded(key.replace(/^b-/, '')) ? 0 : bodyRows)
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
      // 제목 바로 아래: 이 탭을 마지막으로 다룬 세션과 갱신 시각.
      {
        el: (
          <Text key="b-session" dimColor>
            {`${sessionLabel(tab.session) ?? '세션 기록 없음'} · ${ago(tab.updatedAt, Date.now())} 갱신`}
          </Text>
        ),
        rows: textRows(`${sessionLabel(tab.session) ?? '세션 기록 없음'} · 59분 전 갱신`, cols),
      },
      tab.goal ? { el: section('b-goal', '목표', 'cyan', isRich ? md('goal-md', tab.goal) : <Text>{tab.goal}</Text>), rows: sectionRows('b-goal', textRows(tab.goal, cols - 2)) } : undefined,
      tab.doneWhen
        ? { el: section('b-doneWhen', '종료 조건', 'yellow', isRich ? md('doneWhen-md', tab.doneWhen) : <Text>{tab.doneWhen}</Text>), rows: sectionRows('b-doneWhen', textRows(tab.doneWhen, cols - 2)) }
        : undefined,
      {
        el: (
          <Box key="b-items" marginTop={1}>
            {header('items', '할 일', 'green', `(${done}/${tab.items.length})`)}
          </Box>
        ),
        rows: 2,
      },
      ...(isFolded('items') ? [] : tab.items).map((i, n) => {
        const isCurrent = n === current
        const mark = i.isDone ? '☑' : isCurrent ? '▶' : '☐'
        // 막힘·대기 사유, 풀린 뒤 처리 내역은 단계 바로 아래 줄에.
        const subs = [
          i.status && { key: 'status', text: `${STATUS_MARK[i.status]}${i.note ? `: ${i.note}` : ''}`, color: i.status === 'blocked' ? 'red' : 'yellow' },
          i.resolved && { key: 'resolved', text: `↳ 해결: ${i.resolved}`, color: 'green' },
        ].filter((x): x is { key: string; text: string; color: string } => Boolean(x))
        return {
          // 줄 어디를 눌러도 체크가 바뀐다. 데스크톱은 버튼을 label 로 그리므로 label 에도 표시를 넣는다.
          el: (
            <Box key={`item-${n}`} flexDirection="column" paddingLeft={2}>
              <Button key={`chk-${n}`} label={`${mark} ${i.text}`} plain dimColor={i.isDone} onPress={toggle(n)}>
                {`${mark} `}
                {isCurrent ? (
                  <Text bold strikethrough={false} color="white" backgroundColor={CURRENT_BG}>
                    {i.text}
                  </Text>
                ) : (
                  <Text strikethrough={i.isDone} dimColor={i.isDone}>
                    {i.text}
                  </Text>
                )}
              </Button>
              {subs.map(x => (
                <Text key={`item-${n}-${x.key}`} color={x.color}>
                  {`   ${x.text}`}
                </Text>
              ))}
            </Box>
          ),
          rows: textRows(`☐ ${i.text}`, cols - 2) + subs.reduce((sum, x) => sum + textRows(`   ${x.text}`, cols - 2), 0),
        }
      }),
      tab.results?.length
        ? {
            el: section(
              'b-results',
              '결과물',
              'blue',
              isRich
                ? md('results-md', tab.results.map(r => `- ${r.replace(URL_RE, u => `[${u}](${u})`)}`).join('\n'))
                : tab.results.map((r, n) => {
                // 주소가 들어 있으면 그 부분을 누를 수 있는 링크로. 앞뒤 글자는 그대로 둔다.
                const url = r.match(URL_RE)?.[0]
                if (url === undefined) return <Text key={`result-${n}`}>{`- ${r}`}</Text>
                const [before, after] = [r.slice(0, r.indexOf(url)), r.slice(r.indexOf(url) + url.length)]
                return (
                  <Box key={`result-${n}`} flexDirection="row" flexWrap="wrap">
                    <Text>{`- ${before}`}</Text>
                    <Link key={`result-link-${n}`} href={url} />
                    {after.trim() !== '' && <Text>{after}</Text>}
                  </Box>
                )
              }),
              `(${tab.results.length})`,
            ),
            rows: sectionRows('b-results', tab.results.reduce((sum, r) => sum + textRows(`- ${r}`, cols - 2), 0)),
          }
        : undefined,
      memoLines.length > 0
        ? {
            el: section(
              'b-memo',
              '메모',
              'magenta',
              isRich
                ? md('memo-md', memoLines.map(line => (line.trimStart().startsWith('-') ? line : `- ${line}`)).join('\n'), true)
                : memoLines.map((line, n) => (
                <Text key={`memo-${n}`} dimColor>
                  {line.trimStart().startsWith('-') ? line : `- ${line}`}
                </Text>
              )),
              `(${memoLines.length}줄)`,
            ),
            rows: sectionRows('b-memo', memoLines.reduce((sum, line) => sum + textRows(`- ${line}`, cols - 2), 0)),
          }
        : undefined,
    ].filter((x): x is { el: RenderChildren; rows: number } => x !== undefined)
    // 아래 버튼 줄([탭 지우기]·[되돌리기])은 본문과 따로 창 맨 아래에 고정한다.
    // [닫기] 는 오른쪽 끝에 둔다(가운데 빈 칸이 밀어 줌). 우상단 × 는 Claude Code 의 것이라 옮길 수 없다.
    const bar = buttonBar(Box, [
      <Button key="remove" onPress={remove}>
        탭 지우기
      </Button>,
      undoButton,
      redoButton,
      <Box key="bar-gap" flexGrow={1} />,
      <Button key="close" onPress={() => void $.ui.close({ id: PANE })}>
        ✕ 닫기
      </Button>,
    ])
    const barRows = 2 + textRows(['탭 지우기', undoText, redoText, '✕ 닫기'].filter(Boolean).map(x => `[ ${x} ]`).join(' '), cols - 2)
    // 창 높이에서 탭 줄(테두리 2줄 + 접힌 줄 수)·버튼 줄·여유 한 줄을 빼고 남은 만큼이 본문 자리다.
    const tabWidth = b.tabs.reduce((w, t) => w + cellWidth(t.title) + 6, 0)
    const tabRows = 2 + Math.max(1, Math.ceil(tabWidth / cols))
    const avail = e.props.scroll.bodyRows - tabRows - barRows - 1
    const total = blocks.reduce((sum, x) => sum + x.rows, 0)
    // 다 들어가면 그대로 그린다.
    // 안 들어가면 [▲ 위로] 줄·[▼ 아래로] 줄을 늘 남기고(자리가 들썩이지 않게), 그 사이 창에서
    // 본문 전체를 위로 off 줄만큼 밀어 올려 보여 준다. 줄 수는 어림이라 끝에 한 줄 여유를 더 둔다.
    const room = Math.max(1, avail - 2)
    // 터미널만 줄 수를 세어 직접 스크롤한다. 데스크톱 등은 창이 알아서 스크롤하므로 그대로 이어 그린다.
    const isTerminal = e.surface === 'terminal'
    const isScrollable = isTerminal && total > avail
    if (isTerminal) maxScroll = isScrollable ? total - room + 1 : 0
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
    // 본문은 제 높이를 지킨다(flexShrink 0). 기본값(1)이면 창보다 길 때 상자들이 눌려 줄어,
    // 구역 위 빈 줄에 앞 구역 글자가 겹쳐 그려지고 한 줄짜리 '할 일' 제목은 아예 사라진다.
    const body = blocks.map(x => x.el)

    // 옆에 붙은 창(dock)은 창 높이를 꽉 채워 버튼 줄이 늘 맨 아래에 오게 한다. 프롬프트 위 창(inline)은 내용 높이만큼.
    const isDock = isTerminal && e.props.placement === 'dock'
    return (
      <Box key="pane-root" flexDirection="column" paddingLeft={gutter} height={isDock ? e.props.scroll.bodyRows - 1 : undefined}>
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
                <Box key="viewport-body" flexDirection="column" flexShrink={0} marginTop={-off}>
                  {body}
                </Box>
              </Box>
              {pager('scroll-down', off < maxScroll ? `▼ 아래로 (${maxScroll - off}줄)` : undefined, down)}
            </Box>
          ) : (
            <Box key="content" flexDirection="column" flexShrink={0}>
              {body}
            </Box>
          )}
        </Box>
        {bar}
      </Box>
    )
  })
}
