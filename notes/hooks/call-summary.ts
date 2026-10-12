// 대화창에 그릴 notes 도구 호출 한 줄. 탭 전체를 펼치지 않고 "무슨 탭에 무엇을 했는지"만 적는다.
export const NOTES_TOOL_PREFIX = 'mcp__notes__notes_'

// 설정 callDisplay 값. 기본은 요약.
export type CallDisplay = '요약' | '숨김' | '원래대로'
export const CALL_DISPLAYS: readonly CallDisplay[] = ['요약', '숨김', '원래대로']
export const toCallDisplay = (value: unknown): CallDisplay =>
  CALL_DISPLAYS.includes(value as CallDisplay) ? (value as CallDisplay) : '요약'

const STATUS_WORD: Record<string, string> = { blocked: '막힘', waiting: '대기', clear: '풀림' }

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)
const nums = (value: unknown) => (Array.isArray(value) ? value.map(n => `#${n}`).join(', ') : '')

const writeAction = (input: Record<string, unknown>) => {
  const parts = [
    count(input.items) > 0 && `단계 ${count(input.items)}개`,
    count(input.add_items) > 0 && `단계 ${count(input.add_items)}개 추가`,
    typeof input.goal === 'string' && '목표',
    typeof input.done_when === 'string' && '종료 조건',
    (count(input.results) > 0 || count(input.add_results) > 0) && '결과물',
    typeof input.memo === 'string' && '메모',
  ].filter((x): x is string => typeof x === 'string')
  return parts.length > 0 ? parts.join(' · ') : '갱신'
}

// 도구 이름(notes_ 뒤)과 입력으로 "탭 · 한 일" 을 만든다. notes 도구가 아니면 undefined.
export const callSummary = (tool: string, raw: unknown): string | undefined => {
  if (!tool.startsWith(NOTES_TOOL_PREFIX)) return undefined
  const input = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tab = typeof input.tab === 'string' && input.tab !== '' ? input.tab : undefined
  const kind = tool.slice(NOTES_TOOL_PREFIX.length)
  const action =
    kind === 'write' ? writeAction(input)
    : kind === 'check' ? `${nums(input.items)} ${input.done === false ? '체크 취소' : '체크'}`
    : kind === 'status' ? `#${String(input.item)} ${STATUS_WORD[String(input.status)] ?? String(input.status)}`
    : kind === 'read' ? (tab ? '읽음' : '탭 목록 읽음')
    : kind === 'close' ? '탭 닫음'
    : kind
  return `📝 notes · ${tab ? `${tab} · ` : ''}${action}`
}
