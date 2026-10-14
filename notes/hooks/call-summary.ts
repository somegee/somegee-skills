// 대화창에 그릴 notes 도구 호출 한 줄. 탭 전체를 펼치지 않고 "무슨 탭에 무엇을 했는지"만 적는다.
import { TEXT, type Strings } from './i18n'

export const NOTES_TOOL_PREFIX = 'mcp__notes__notes_'

// 설정 callDisplay 값. 기본은 요약.
export type CallDisplay = '요약' | '숨김' | '원래대로'
export const CALL_DISPLAYS: readonly CallDisplay[] = ['요약', '숨김', '원래대로']
export const toCallDisplay = (value: unknown): CallDisplay =>
  CALL_DISPLAYS.includes(value as CallDisplay) ? (value as CallDisplay) : '요약'

const statusWord = (t: Strings, status: unknown) =>
  status === 'blocked' ? t.blocked : status === 'waiting' ? t.waiting : status === 'clear' ? t.cleared : String(status)

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)
const nums = (value: unknown) => (Array.isArray(value) ? value.map(n => `#${n}`).join(', ') : '')

const writeAction = (input: Record<string, unknown>, c: Strings['call']) => {
  const parts = [
    count(input.items) > 0 && c.steps(count(input.items)),
    count(input.add_items) > 0 && c.addSteps(count(input.add_items)),
    typeof input.goal === 'string' && c.goal,
    typeof input.done_when === 'string' && c.doneWhen,
    (count(input.results) > 0 || count(input.add_results) > 0) && c.results,
    typeof input.memo === 'string' && c.memo,
  ].filter((x): x is string => typeof x === 'string')
  return parts.length > 0 ? parts.join(' · ') : c.refresh
}

// 도구 이름(notes_ 뒤)과 입력으로 "탭 · 한 일" 을 만든다. notes 도구가 아니면 undefined.
export const callSummary = (tool: string, raw: unknown, t: Strings = TEXT.ko): string | undefined => {
  if (!tool.startsWith(NOTES_TOOL_PREFIX)) return undefined
  const input = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tab = typeof input.tab === 'string' && input.tab !== '' ? input.tab : undefined
  const kind = tool.slice(NOTES_TOOL_PREFIX.length)
  const action =
    kind === 'write' ? writeAction(input, t.call)
    : kind === 'check' ? `${nums(input.items)} ${input.done === false ? t.call.uncheck : t.call.check}`
    : kind === 'status' ? `#${String(input.item)} ${statusWord(t, input.status)}`
    : kind === 'read' ? (tab ? t.call.read : t.call.readAll)
    : kind === 'close' ? t.call.close
    : kind
  return `📝 notes · ${tab ? `${tab} · ` : ''}${action}`
}
