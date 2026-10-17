import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import { callSummary, toCallDisplay } from './call-summary'
import { TEXT, toLang, type Strings } from './i18n'
import { BASE_THEME, toTheme, type NotesTheme } from './theme'
import { mergeTabs, noteFileName, SHARED_FILE, toShareScope, type ShareScope } from './share-scope'
import type { LiveState, NoteChange, NoteChangePart, NoteItem, NoteItemStatus, NotesBook, NoteSession, NoteTab } from '../types'

const PANE = 'notes'
// 화면·도구 설명·사용 규칙의 문구. register 가 설정 language 로 고른다(기본 한국어).
let L: Strings = TEXT.ko
const MAX_TABS = 30
const MAX_HISTORY = 20
const book = atom({ plugin: 'notes', key: 'book' } as const, { root: '', tabs: [], history: [], future: [] } as NotesBook)
const scroll = atom({ plugin: 'notes', key: 'scroll' } as const, 0)
const tick = atom({ plugin: 'notes', key: 'tick' } as const, 0)
// 접어 둔 구역. 키 = '<탭 이름>|<구역>'. 이 세션에서만 유지된다(다른 세션·파일과 공유하지 않음).
const live = atom({ plugin: 'notes', key: 'live' } as const, {} as Record<string, LiveState>)
const folded = atom({ plugin: 'notes', key: 'folded' } as const, {} as Record<string, boolean>)

const SYNC_MS = 3000
// 'N분 전 갱신' 이 흐르도록 다시 그리는 간격.
const TICK_MS = 30000
// 터미널 창 색(theme.ts). register 가 설정 theme·background 로 고른다.
let theme: NotesTheme = BASE_THEME
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
  (s?.id !== undefined && s.id === sessionId ? sessionTitle : undefined) ?? s?.title ?? (s?.id ? L.session(s.id.slice(0, 8)) : undefined)

// 마지막 갱신이 지금부터 얼마 전인지 사람 말로.
const ago = (iso: string, nowMs: number) => {
  const sec = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (!Number.isFinite(sec) || sec < 60) return L.justNow
  if (sec < 3600) return L.minAgo(Math.floor(sec / 60))
  if (sec < 86400) return L.hourAgo(Math.floor(sec / 3600))
  return L.dayAgo(Math.floor(sec / 86400))
}

const statusMark = (s: NoteItemStatus) => (s === 'blocked' ? `⛔ ${L.blocked}` : `⏳ ${L.waiting}`)
// 탭 줄 표시: 안 끝난 단계에 막힘이 하나라도 있으면 빨강, 대기만 있으면 노랑. 다른 탭에서 일하는 중에도 한눈에 보이게.
// 세션 표시: 그 탭을 마지막으로 다룬 세션이 일하는 중이면 초록 ●, 질문·허락 창을 띄웠으면 청록 💬. 모든 단계가 끝나면 ✅.
// 여러 개가 겹치면 하나만: ✅ → ⛔ → 💬 → ⏳ → ●. 다 끝난 탭은 그 세션이 다른 일을 하는 중이어도 ✅ 만 보인다
// (막힘·대기는 안 끝난 단계에만 붙으니 ✅ 와 겹치지 않는다).
// ●·💬 는 그 세션이 가장 최근에 고친 탭 하나에만 켠다. 한 세션이 탭 A 를 하다 새 탭 B 로 넘어가면 A 는 꺼진다.
type TabMark = NoteItemStatus | 'ask' | 'working' | 'done'
const TAB_MARK: Record<TabMark, string> = { blocked: '⛔', ask: '💬', waiting: '⏳', working: '●', done: '✅' }
// 세션 id → 그 세션이 가장 최근에 고친 탭 이름.
const latestTabs = (tabs: NoteTab[]) => {
  const latest = new Map<string, NoteTab>()
  for (const t of tabs) {
    if (t.session === undefined) continue
    const prev = latest.get(t.session.id)
    if (prev === undefined || Date.parse(t.updatedAt) >= Date.parse(prev.updatedAt)) latest.set(t.session.id, t)
  }
  return new Map([...latest].map(([id, t]) => [id, t.title]))
}
const tabMark = (t: NoteTab, states: Record<string, LiveState>, latest: Map<string, string>): TabMark | undefined => {
  const open = t.items.filter(i => !i.isDone)
  if (t.items.length > 0 && open.length === 0) return 'done'
  const isSessionTab = t.session !== undefined && latest.get(t.session.id) === t.title
  const state = isSessionTab ? states[t.session!.id] : undefined
  if (open.some(i => i.status === 'blocked')) return 'blocked'
  if (state === 'ask') return 'ask'
  if (open.some(i => i.status === 'waiting')) return 'waiting'
  return state === 'working' ? 'working' : undefined
}

// 세션 상태는 세션마다 <notes-data>/live/<세션 id>.json 한 파일에 { state, at } 로 쓴다(노트 파일과 따로라 서로 덮어쓰지 않는다).
// 일하는 동안은 1분마다 at 을 새로 쓰고, 3분 넘게 소식이 없으면 꺼진 세션으로 보고 무시한다.
const LIVE_BEAT_MS = 60000
const LIVE_STALE_MS = 180000
let myLive: { state: LiveState; at: number } = { state: 'idle', at: 0 }
const livePath = ($: EngineInterface, id: string) => `${dataDir($.plugin.root)}/live/${id.replace(/[^A-Za-z0-9-]/g, '')}.json`
async function setLive($: EngineInterface, state: LiveState) {
  if (sessionId === '' || state === myLive.state) return
  myLive = { state, at: Date.now() }
  await update($, live, m => ({ ...m, [sessionId]: state }))
  await writeLive($)
}
const writeLive = ($: EngineInterface) =>
  $.fs.write(livePath($, sessionId), JSON.stringify({ state: myLive.state, at: new Date(myLive.at).toISOString() })).catch(() => undefined)
// 3초 동기화 때: 내 상태가 일하는 중이면 1분마다 at 갱신, 탭에 걸린 다른 세션들의 상태 파일을 읽는다.
async function syncLive($: EngineInterface) {
  if (sessionId === '') return
  if (myLive.state !== 'idle' && Date.now() - myLive.at >= LIVE_BEAT_MS) {
    myLive = { ...myLive, at: Date.now() }
    await writeLive($)
  }
  const ids = [...new Set((await read($, book)).tabs.map(t => t.session?.id).filter((id): id is string => !!id && id !== sessionId))]
  const next: Record<string, LiveState> = { [sessionId]: myLive.state }
  for (const id of ids) {
    try {
      const v = JSON.parse(await $.fs.read(livePath($, id))) as { state?: unknown; at?: unknown }
      const isFresh = typeof v.at === 'string' && Date.now() - Date.parse(v.at) < LIVE_STALE_MS
      if (isFresh && (v.state === 'working' || v.state === 'ask')) next[id] = v.state
    } catch {
      // 상태 파일이 없으면(그 세션은 이 기능 이전 버전이거나 아직 일하지 않음) 표시하지 않는다.
    }
  }
  const cur = await read($, live)
  if (JSON.stringify(cur) !== JSON.stringify(next)) await update($, live, () => next)
}
// 노트는 <.claude>/notes-data/ 아래 한 파일에 두고, 그 파일을 쓰는 세션들이 함께 읽고 쓴다(공유 범위는 share-scope.ts).
// 전체 = _all.json, 같은 폴더 = <작업 폴더>.json, 세션마다 = sessions/<세션 id>.json.
// 마켓플레이스 설치본은 버전마다 폴더가 바뀌므로 모드 폴더 밖에 둔다. .claude 아래가 아니면 모드 폴더의 data/.
let shareScope: ShareScope = '전체'
const dataDir = (pluginRoot: string) => {
  const claudeDir = pluginRoot.match(/^(.*?[\\/]\.claude)[\\/]/)?.[1]
  return claudeDir === undefined ? `${pluginRoot}/data` : `${claudeDir}/notes-data`
}
const dataPath = ($: EngineInterface, root: string) => `${dataDir($.plugin.root)}/${noteFileName(shareScope, root, sessionId)}`
const now = () => new Date().toISOString()
const asText = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)
const asList = (v: unknown) =>
  Array.isArray(v) ? v.map(asText).filter((s): s is string => s !== undefined) : []

const findTab = (b: NotesBook, title: string | undefined) =>
  title === undefined ? undefined : b.tabs.find(t => t.title === title)

const describeTab = (tab: NoteTab) => {
  const done = tab.items.filter(i => i.isDone).length
  const lines = [`# ${tab.title} (${done}/${tab.items.length})`]
  if (tab.goal) lines.push(`${L.goal}: ${tab.goal}`)
  if (tab.doneWhen) lines.push(`${L.doneWhen}: ${tab.doneWhen}`)
  tab.items.forEach((i, n) => {
    lines.push(`#${n + 1} [${i.isDone ? 'x' : ' '}] ${i.text}`)
    if (i.status) lines.push(`    ${statusMark(i.status)}${i.note ? `: ${i.note}` : ''}`)
    if (i.resolved) lines.push(`    ${L.resolved}: ${i.resolved}`)
  })
  if (tab.results?.length) lines.push(`${L.results}: ${tab.results.join(' / ')}`)
  if (tab.memo) lines.push(`${L.memo}: ${tab.memo}`)
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

// 전체 공유 파일이 아직 없으면(처음 전체로 바꾼 PC) 지금까지 폴더별로 쓰던 노트 탭을 모아 만든다.
async function seedShared($: EngineInterface, root: string) {
  const dir = dataDir($.plugin.root)
  if ((await readText($, `${dir}/${SHARED_FILE}`)) !== undefined) return
  const lists: NoteTab[][] = []
  try {
    for (const f of await $.fs.list(dir)) {
      if (!f.name.endsWith('.json') || f.name === SHARED_FILE) continue
      try {
        const tabs = (JSON.parse((await readText($, `${dir}/${f.name}`)) ?? '{}') as Partial<Saved>).tabs
        if (Array.isArray(tabs)) lists.push(tabs)
      } catch {
        // 깨진 파일은 건너뛴다.
      }
    }
  } catch {
    // 폴더가 없으면 빈 노트로 시작한다.
  }
  const tabs = mergeTabs(lists, MAX_TABS)
  if (tabs.length > 0) await save($, root, { tabs, history: [], future: [] })
}

// /clear 하면 세션 상태가 처음 값(root '')으로 돌아가는데 session.start 는 다시 오지 않는다.
// 그때 root 가 비어 있으면 엔진에 다시 물어 채운다(빈 root 로는 이름 없는 노트 파일 .json 에 쓰게 된다).
async function projectRoot($: EngineInterface) {
  const { root } = await read($, book)
  if (root !== '') return root
  const fresh = await $.session.root()
  sessionId = await $.session.id()
  await update($, book, c => ({ ...c, root: fresh }))
  return fresh
}

// 다른 세션이 고친 내용을 덮어쓰지 않도록, 고치기 직전에 파일의 최신본을 다시 읽어 그 위에 반영한다.
// label 은 되돌리기 버튼에 보일 설명이다. 새로 고치면 앞으로가기 기록은 버린다.
async function change($: EngineInterface, label: string, fn: (b: NotesBook) => NotesBook) {
  const root = await projectRoot($)
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
  const root = await projectRoot($)
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
  const root = await projectRoot($)
  const cur = await read($, book)
  const saved = await loadFile($, root)
  if (JSON.stringify(saved) === JSON.stringify({ tabs: cur.tabs, history: cur.history, future: cur.future ?? [] })) return
  await update($, book, c => ({ ...c, ...saved, active: saved.tabs.some(t => t.title === c.active) ? c.active : saved.tabs.at(-1)?.title }))
}

// 터미널에서 글자가 차지하는 칸 수. 한글·한자·전각 문자와 체크 칸은 두 칸으로 센다.
const WIDE = /[ᄀ-ᅟ☐-☒⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const cellWidth = (s: string) => [...s].reduce((w, ch) => w + (WIDE.test(ch) ? 2 : 1), 0)

// 버튼 줄([탭 지우기]·[되돌리기]·[앞으로]): 탭 줄 바로 아래 한 줄. 탭을 고른 자리에서 바로 누르게.
// 창 폭에 맞춰 글자를 줄인다: 넉넉하면 '↶ 되돌리기: <무엇>', 모자라면 '↶ 되돌리기', 더 좁으면 아이콘만.
type BarButton = { key: string; icon: string; text: string; detail?: string; onPress: () => void }
const BAR_ICON = { remove: '✕', undo: '↶', redo: '↷' } as const
const barLabels = (buttons: BarButton[], cols: number) => {
  const levels = [
    buttons.map(x => `${x.icon} ${x.text}${x.detail ? `: ${x.detail}` : ''}`),
    buttons.map(x => `${x.icon} ${x.text}`),
    buttons.map(x => x.icon),
  ]
  // 테두리 있는 버튼은 '[ 글자 ]' 로 4칸이 붙고, 버튼 사이는 한 칸 띈다.
  const width = (labels: string[]) => labels.reduce((w, s) => w + cellWidth(s) + 4, 0) + Math.max(0, labels.length - 1)
  return levels.find(l => width(l) <= cols) ?? levels.at(-1)!
}
// 폭 cols 에 접혀 들어갈 때 몇 줄이 되는지(대략).
const textRows = (s: string, cols: number) => Math.max(1, Math.ceil(cellWidth(s) / Math.max(1, cols)))

// 마지막으로 그린 탭에서 본문을 내릴 수 있는 최대 줄 수. 휠이 끝을 넘지 않게 그릴 때마다 갱신한다.
let maxScroll = 0

const ok = (text: string) => ({ result: text })
const failed = () => ({ deny: L.failed })
// 노트는 사람이 보는 메인 에이전트만 쓴다. 서브에이전트·팀원 루프에서 부르면 거절한다.
const mainOnly = () => ({ deny: L.mainOnly })

// 매 세션 시스템 프롬프트 끝에 붙는 사용 규칙(i18n.ts 의 guide). 고정 문구라 프롬프트 캐시를 깨지 않는다.

export const register: Register = (on, options) => {
  L = TEXT[toLang(options.language)]
  // 헤드리스(크론·-p·SDK)에서도 노트를 쓸지. /config 의 notes.headless, 기본은 끔.
  const useHeadless = options.headless === true
  // 노트를 어느 세션끼리 공유할지. /config 의 notes.shareScope, 기본은 이 PC 의 모든 세션.
  shareScope = toShareScope(options.shareScope)
  // 터미널 창 테마와 직접 고른 배경색. /config 의 notes.theme·notes.background.
  theme = toTheme(options.theme, options.background)
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // 헤드리스(-p·SDK)는 그릴 곳이 없다. 설정으로 켜지 않았으면 보는 사람이 없으니 규칙을 넣지 않는다.
    if (e.surfaces.length === 0 && !useHeadless) return composed
    return { sections: [...composed.sections, { id: 'notes:guide', text: L.guide, scope: 'session' }] }
  })

  // 세션 이름은 classic 훅 입력의 session_title 로만 알 수 있다. 시작할 때와 프롬프트마다 갱신한다(/rename 반영).
  // classic 훅은 기록 파일 경로를 준다. 시작할 때와 프롬프트를 보낼 때마다 이름을 다시 읽는다(/rename 반영).
  on('classic.SessionStart', async ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') transcriptPath = e.transcript_path
    // /clear 는 세션 상태를 비운다. 3초 주기 동기화를 기다리지 않고 노트 파일을 바로 다시 읽는다.
    if (e.source === 'clear') await sync($)
    await refreshTitle($)
    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') transcriptPath = e.transcript_path
    await refreshTitle($)
    return next(e)
  })

  // 세션 상태: 턴이 시작되면 일하는 중, 끝나면 쉼. 허락 창·질문 창이 뜨면 답 필요, 그 도구 호출이 끝나면 다시 일하는 중.
  on('turn.start', async ($, e, next) => {
    await setLive($, 'working')
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    // 서브에이전트의 턴 끝은 메인 세션이 쉬는 게 아니다.
    if (e.agentId === undefined) await setLive($, 'idle')
    return next(e)
  })
  on('classic.PermissionRequest', async ($, e, next) => {
    await setLive($, 'ask')
    return next(e)
  })
  on('tool.call', { tool: /^(AskUserQuestion|ExitPlanMode)$/ }, async ($, e, next) => {
    if (e.agentId === undefined) await setLive($, 'ask')
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (myLive.state === 'ask') await setLive($, 'working')
    return result
  })
  on('session.end', async ($, e, next) => {
    await setLive($, 'idle')
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    // 헤드리스(크론·-p·SDK)는 볼 사람이 없다. 설정으로 켜지 않았으면 도구를 등록하지 않아 노트 파일에 쓰지 못하게 한다.
    if (!e.isInteractive && !useHeadless) return next(e)
    const root = await $.session.root()
    sessionId = await $.session.id()
    if (shareScope === '전체') await seedShared($, root)
    const saved = await loadFile($, root)
    await update($, book, () => ({ root, ...saved, active: saved.tabs.at(-1)?.title }))
    // 3초마다: 다른 세션이 고친 노트 반영 + /rename 한 이름 반영.
    $.clock.every(SYNC_MS, () => void sync($).then(() => Promise.all([refreshTitle($, true), syncLive($)])))
    $.clock.every(TICK_MS, () => void update($, tick, n => (n + 1) % 100000).then(() => refreshTitle($)))
    void refreshTitle($)
    // 기본은 세션을 열면 창도 연다. /config 의 notes.autoOpen 을 끄면 /notes 로만 연다.
    if (options.autoOpen !== false && e.isInteractive) void $.ui.open({ id: PANE, title: 'notes' })

    await $.command.register({ name: 'notes', description: L.command })
    await $.tool.register({
      name: 'notes_write',
      isDeferred: false,
      description: L.tools.write,
      inputSchema: {
        type: 'object',
        properties: {
          tab: { type: 'string', description: L.tools.writeTab },
          goal: { type: 'string', description: L.tools.writeGoal },
          done_when: { type: 'string', description: L.tools.writeDoneWhen },
          items: { type: 'array', items: { type: 'string' }, description: L.tools.writeItems },
          add_items: { type: 'array', items: { type: 'string' }, description: L.tools.writeAddItems },
          memo: { type: 'string', description: L.tools.writeMemo },
          results: { type: 'array', items: { type: 'string' }, description: L.tools.writeResults },
          add_results: { type: 'array', items: { type: 'string' }, description: L.tools.writeAddResults },
        },
        required: ['tab'],
      },
    })
    await $.tool.register({
      name: 'notes_status',
      isDeferred: false,
      description: L.tools.status,
      inputSchema: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          item: { type: 'integer', description: L.tools.statusItem },
          status: { type: 'string', enum: ['blocked', 'waiting', 'clear'], description: L.tools.statusStatus },
          note: { type: 'string', description: L.tools.statusNote },
        },
        required: ['tab', 'item', 'status'],
      },
    })
    await $.tool.register({
      name: 'notes_check',
      isDeferred: false,
      description: L.tools.check,
      inputSchema: {
        type: 'object',
        properties: {
          tab: { type: 'string' },
          items: { type: 'array', items: { type: 'integer' }, description: L.tools.checkItems },
          done: { type: 'boolean', description: L.tools.checkDone },
        },
        required: ['tab', 'items'],
      },
    })
    await $.tool.register({
      name: 'notes_read',
      isDeferred: false,
      description: L.tools.read,
      inputSchema: { type: 'object', properties: { tab: { type: 'string' } } },
    })
    await $.tool.register({
      name: 'notes_close',
      isDeferred: false,
      description: L.tools.close,
      inputSchema: { type: 'object', properties: { tab: { type: 'string' } }, required: ['tab'] },
    })

    return next(e)
  })

  // /notes 는 열기·닫기를 오간다: 창이 보이고 있으면 닫고, 아니면 연다(닫기 버튼 대신).
  on('command.run', { command: 'notes' }, async $ => {
    const isShown = (await $.ui.panes()).some(p => p.id === PANE && p.isShown && p.isPlaced)
    if (isShown) {
      await $.ui.close({ id: PANE })
      return { text: L.paneClosed }
    }
    await $.ui.open({ id: PANE, title: 'notes' })
    const b = await read($, book)
    return { text: L.opened(b.tabs.length) }
  })

  on('tool.call', { tool: 'mcp__notes__notes_write' }, async ($, e) => {
    if (e.agentId !== undefined) return mainOnly()
    const a = e as unknown as Record<string, unknown>
    const title = asText(a.tab)?.slice(0, 40)
    if (title === undefined) return { deny: L.needTab }
    const isNew = findTab(await read($, book), title) === undefined

    const b = await change($, isNew ? L.logNewTab(title) : L.logEdit(title), cur => {
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
    if (e.agentId !== undefined) return mainOnly()
    const a = e as unknown as Record<string, unknown>
    const title = asText(a.tab)
    const cur = await read($, book)
    const tab = findTab(cur, title)
    if (tab === undefined) return { deny: `${L.noTab(title)} ${L.tabList(cur.tabs.map(x => x.title).join(', '))}` }
    const nums = Array.isArray(a.items) ? a.items.filter((n): n is number => Number.isInteger(n)) : []
    const bad = nums.filter(n => n < 1 || n > tab.items.length)
    if (bad.length > 0) return { deny: L.badItems(bad.join(', '), tab.items.length) }
    const isDone = a.done !== false

    const b = await change($, L.logCheck(tab.title), c => ({
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
    if (e.agentId !== undefined) return mainOnly()
    const a = e as unknown as Record<string, unknown>
    const title = asText(a.tab)
    const cur = await read($, book)
    const tab = findTab(cur, title)
    if (tab === undefined) return { deny: `${L.noTab(title)} ${L.tabList(cur.tabs.map(x => x.title).join(', '))}` }
    const n = Number.isInteger(a.item) ? (a.item as number) : 0
    if (n < 1 || n > tab.items.length) return { deny: L.badItems(String(a.item), tab.items.length) }
    const status = a.status
    if (status !== 'blocked' && status !== 'waiting' && status !== 'clear') return { deny: L.badStatus }
    const note = asText(a.note)
    const apply = (i: NoteItem): NoteItem => {
      if (status === 'clear') {
        const { status: _s, note: _n, ...rest } = i
        return { ...rest, resolved: note ?? i.resolved ?? L.resolvedDefault }
      }
      return { ...i, status, note, resolved: undefined }
    }
    const label = L.logStatus(n, status === 'clear' ? L.cleared : status === 'blocked' ? L.blocked : L.waiting)
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
    if (e.agentId !== undefined) return mainOnly()
    const a = e as unknown as Record<string, unknown>
    const b = await read($, book)
    const title = asText(a.tab)
    if (title !== undefined) {
      const tab = findTab(b, title)
      return tab ? ok(describeTab(tab)) : { deny: L.noTab(title) }
    }
    if (b.tabs.length === 0) return ok(L.noTabs)
    return ok(b.tabs.map(describeTab).join('\n\n'))
  }).catch(failed)

  on('tool.call', { tool: 'mcp__notes__notes_close' }, async ($, e) => {
    if (e.agentId !== undefined) return mainOnly()
    const title = asText((e as unknown as Record<string, unknown>).tab)
    const cur = await read($, book)
    if (findTab(cur, title) === undefined) return { deny: L.noTab(title) }
    await change($, L.logClose(title!), c => {
      const tabs = c.tabs.filter(t => t.title !== title)
      return { ...c, tabs, active: c.active === title ? tabs.at(-1)?.title : c.active }
    })
    return ok(L.closed(title))
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
    const summary = callSummary(e.props.tool, e.props.input, L)
    if (summary === undefined || callDisplay === '원래대로') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    if (callDisplay === '숨김') return <Box key="notes-hidden" />
    const { isRunning, isErrored, isInterrupted } = e.props
    const tail = isErrored ? L.call.failed : isInterrupted ? L.call.interrupted : isRunning ? ' …' : ''
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
    // 테마는 터미널에만 칠한다. 데스크톱 등은 Markdown 글자색을 바꿀 수 없어 기본 색을 쓴다.
    const th = e.surface === 'terminal' ? theme : BASE_THEME
    const b = await read($, book)
    const states = await read($, live)
    const latest = latestTabs(b.tabs)
    const tab = findTab(b, b.active) ?? b.tabs.at(-1)
    const last = b.history.at(-1)

    const nextUp = (b.future ?? []).at(-1)
    const short = (label: string) => (label.length > 16 ? `${label.slice(0, 16)}…` : label)
    const cols = Math.max(10, e.props.bodyColumns - 2 - gutter)
    const historyButtons: BarButton[] = [
      last && { key: 'undo', icon: BAR_ICON.undo, text: L.undo, detail: short(last.label), onPress: () => void undo($) },
      nextUp && { key: 'redo', icon: BAR_ICON.redo, text: L.redo, detail: short(nextUp.label), onPress: () => void redo($) },
    ].filter((x): x is BarButton => Boolean(x))
    // 한 줄로만 그린다(테두리 없음). 탭 줄 안쪽 글자와 줄이 맞게 좌우 한 칸 띄운다.
    const buttonBar = (buttons: BarButton[]) => {
      const labels = barLabels(buttons, cols)
      return (
        <Box key="bar" flexDirection="row" columnGap={1} paddingX={1}>
          {buttons.map((x, n) => (
            <Button key={x.key} onPress={x.onPress}>
              {labels[n]}
            </Button>
          ))}
        </Box>
      )
    }

    if (tab === undefined) {
      return (
        <Box key="pane-root" flexDirection="column" paddingLeft={gutter} backgroundColor={th.bg}>
          {historyButtons.length > 0 && buttonBar(historyButtons)}
          <Text dimColor color={th.text}>{L.empty}</Text>
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
      void change($, L.logToggle(tab.title, n + 1), c => ({
        ...c,
        tabs: c.tabs.map(t =>
          t.title !== tab.title ? t : { ...t, updatedAt: now(), items: t.items.map((i, k) => (k === n ? { ...i, isDone: !i.isDone } : i)) },
        ),
      }))
    const remove = () =>
      void change($, L.logRemove(tab.title), c => {
        const tabs = c.tabs.filter(t => t.title !== tab.title)
        return { ...c, tabs, active: tabs.at(-1)?.title }
      })

    // 구역마다 제목 줄을 두고 빈 줄로 나눈다: 목표·종료 조건 / 할 일 / 결과물 / 메모. 메모는 체크 칸 없이 흐린 글자로 단계와 구별한다.
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
          <Text key="b-title" bold color={th.text}>
            {tab.title} ({done}/{tab.items.length})
          </Text>
        ),
        rows: textRows(`${tab.title} (${done}/${tab.items.length})`, cols),
      },
      // 제목 바로 아래: 이 탭을 마지막으로 다룬 세션과 갱신 시각.
      {
        el: (
          <Text key="b-session" dimColor color={th.text}>
            {`${sessionLabel(tab.session) ?? L.noSession} · ${L.updated(ago(tab.updatedAt, Date.now()))}`}
          </Text>
        ),
        rows: textRows(`${sessionLabel(tab.session) ?? L.noSession} · ${L.updated(L.agoSample)}`, cols),
      },
      tab.goal ? { el: section('b-goal', L.goal, th.section.goal, isRich ? md('goal-md', tab.goal) : <Text color={th.text}>{tab.goal}</Text>), rows: sectionRows('b-goal', textRows(tab.goal, cols - 2)) } : undefined,
      tab.doneWhen
        ? { el: section('b-doneWhen', L.doneWhen, th.section.doneWhen, isRich ? md('doneWhen-md', tab.doneWhen) : <Text color={th.text}>{tab.doneWhen}</Text>), rows: sectionRows('b-doneWhen', textRows(tab.doneWhen, cols - 2)) }
        : undefined,
      {
        el: (
          <Box key="b-items" marginTop={1}>
            {header('items', L.todo, th.section.todo, `(${done}/${tab.items.length})`)}
          </Box>
        ),
        rows: 2,
      },
      ...(isFolded('items') ? [] : tab.items).map((i, n) => {
        const isCurrent = n === current
        const mark = i.isDone ? '☑' : isCurrent ? '▶' : '☐'
        // 막힘·대기 사유, 풀린 뒤 처리 내역은 단계 바로 아래 줄에.
        const subs = [
          i.status && { key: 'status', text: `${statusMark(i.status)}${i.note ? `: ${i.note}` : ''}`, color: th.mark[i.status] },
          i.resolved && { key: 'resolved', text: `${L.resolved}: ${i.resolved}`, color: th.section.todo },
        ].filter((x): x is { key: string; text: string; color: string } => Boolean(x))
        return {
          // 줄 어디를 눌러도 체크가 바뀐다. 데스크톱은 버튼을 label 로 그리므로 label 에도 표시를 넣는다.
          el: (
            <Box key={`item-${n}`} flexDirection="column" paddingLeft={2}>
              <Button key={`chk-${n}`} label={`${mark} ${i.text}`} plain dimColor={i.isDone} onPress={toggle(n)}>
                <Text color={th.text}>{`${mark} `}</Text>
                {isCurrent ? (
                  <Text bold strikethrough={false} color={th.current.text} backgroundColor={th.current.bg}>
                    {i.text}
                  </Text>
                ) : (
                  <Text strikethrough={i.isDone} dimColor={i.isDone} color={th.text}>
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
              L.results,
              th.section.results,
              isRich
                ? md('results-md', tab.results.map(r => `- ${r.replace(URL_RE, u => `[${u}](${u})`)}`).join('\n'))
                : tab.results.map((r, n) => {
                // 주소가 들어 있으면 그 부분을 누를 수 있는 링크로. 앞뒤 글자는 그대로 둔다.
                const url = r.match(URL_RE)?.[0]
                if (url === undefined) return <Text key={`result-${n}`} color={th.text}>{`- ${r}`}</Text>
                const [before, after] = [r.slice(0, r.indexOf(url)), r.slice(r.indexOf(url) + url.length)]
                return (
                  <Box key={`result-${n}`} flexDirection="row" flexWrap="wrap">
                    <Text color={th.text}>{`- ${before}`}</Text>
                    <Link key={`result-link-${n}`} href={url} />
                    {after.trim() !== '' && <Text color={th.text}>{after}</Text>}
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
              L.memo,
              th.section.memo,
              isRich
                ? md('memo-md', memoLines.map(line => (line.trimStart().startsWith('-') ? line : `- ${line}`)).join('\n'), true)
                : memoLines.map((line, n) => (
                <Text key={`memo-${n}`} dimColor color={th.text}>
                  {line.trimStart().startsWith('-') ? line : `- ${line}`}
                </Text>
              )),
              L.memoLines(memoLines.length),
            ),
            rows: sectionRows('b-memo', memoLines.reduce((sum, line) => sum + textRows(`- ${line}`, cols - 2), 0)),
          }
        : undefined,
    ].filter((x): x is { el: RenderChildren; rows: number } => x !== undefined)
    // 버튼 줄은 탭 줄 바로 아래, 본문과 따로 고정한다(본문을 내려도 그 자리).
    // 창 닫기 버튼은 두지 않는다([탭 지우기]와 헷갈림). 창은 /notes 를 다시 입력하거나 우상단 × 로 닫는다.
    const bar = buttonBar([{ key: 'remove', icon: BAR_ICON.remove, text: L.removeTab, onPress: remove }, ...historyButtons])
    const barRows = 1
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
            <Text italic color={th.text} backgroundColor={th.pagerBg}>
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
      <Box key="pane-root" flexDirection="column" paddingLeft={gutter} height={isDock ? e.props.scroll.bodyRows - 1 : undefined} backgroundColor={th.bg}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} borderStyle="round" borderColor={th.tabBorder} paddingX={1}>
          {b.tabs.map(t => {
            const isActive = t.title === tab.title
            const name = isActive ? `▶ ${t.title}` : t.title
            const marked = tabMark(t, states, latest)
            // 지금 탭 앞 화살표는 탭 줄 테두리와 같은 청록으로 칠한다.
            const arrow = <Text key="arrow" color={th.tabBorder}>▶ </Text>
            // 지금 탭은 기울인 굵은 글씨로 다른 탭과 구별한다. 엔진은 테두리([ ]) 있는 버튼을 통째로 굵게 칠하므로,
            // 다른 탭은 테두리 없는 버튼(plain)에 [ ]를 글자로 넣어 보통 굵기로 그린다.
            if (marked === undefined)
              return (
                <Button key={`tab-${t.title}`} label={name} variant={isActive ? 'primary' : 'secondary'} plain={isActive ? undefined : true} dimColor={!isActive} onPress={select(t.title)}>
                  <Text bold={isActive} italic={isActive} color={th.text}>{isActive ? [arrow, t.title] : `[ ${name} ]`}</Text>
                </Button>
              )
            // 표시가 붙은 탭은 제목 앞에 표시를 붙이고 색을 칠한다(색을 못 보는 화면에서도 표시로 구별). 다 끝난 탭(✅)만 흐리게.
            const mark = TAB_MARK[marked]
            const color = marked === 'done' ? th.text : th.mark[marked]
            const markedTitle = `${mark} ${t.title}`
            return (
              <Button key={`tab-${t.title}`} label={isActive ? `▶ ${markedTitle}` : markedTitle} variant={isActive ? 'primary' : 'secondary'} plain={isActive ? undefined : true} dimColor={!isActive && marked === 'done'} onPress={select(t.title)}>
                <Text bold={isActive} italic={isActive} color={color}>{isActive ? [arrow, markedTitle] : `[ ${markedTitle} ]`}</Text>
              </Button>
            )
          })}
        </Box>
        {bar}
        <Box key="body" flexDirection="column" flexGrow={1}>
          {isScrollable ? (
            <Box flexDirection="column">
              {pager('scroll-up', off > 0 ? L.scrollUp(off) : undefined, up)}
              <Box key="viewport" flexDirection="column" height={room} overflow="hidden">
                <Box key="viewport-body" flexDirection="column" flexShrink={0} marginTop={-off}>
                  {body}
                </Box>
              </Box>
              {pager('scroll-down', off < maxScroll ? L.scrollDown(maxScroll - off) : undefined, down)}
            </Box>
          ) : (
            <Box key="content" flexDirection="column" flexShrink={0}>
              {body}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
