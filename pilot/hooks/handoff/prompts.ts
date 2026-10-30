// 인계 메모 프롬프트(한국어)와 인계 추천 판정. 항목 구성은 effortless(HeyCubit, MIT)의 handoff 프롬프트를 따른다. NOTICE 참고.
import type { HandoffAfter } from '../config'
import { firstJsonObject } from '../haiku'

const BODY = [
  '맨 앞에 프로젝트, 폴더, 브랜치를 적고 이어서:',
  '- 목표: 한두 줄.',
  '- 끝낸 일: 무엇을 바꿨는지 파일 경로와 함께, 각각 어떻게 확인했는지. 계획만 했거나 건너뛰었거나 시험 안 한 것을 끝냈다고 쓰지 않는다.',
  '- 덜 끝낸 일: 반쯤 된 것과 막힌 이유(실패한 검사, 기다리는 승인, 열린 질문).',
  '- git: 로컬 변경, 로컬 커밋, push 한 커밋, 열린 PR — 이 대화에서 마지막으로 본 기준("마지막 확인 기준"이라고 적기).',
  '- 다음 할 일: 우선순위대로. 첫 번째는 바로 할 수 있게(파일 경로, 명령어, 정할 것 하나). 사용자가 해야 하는 단계엔 "사용자 필요"를 붙인다.',
  '- 다시 시작하려면: 시작 명령, 미리보기 주소, 허락이 필요한 일의 한계(승인 필요한 것, 시험 vs 운영).',
  '- 다시 하지 말 것: 내린 결정과 이유, 실패한 방법.',
  '',
  '대화 중 바뀐 것은 마지막 상태만 쓴다. 문서·계획·파일은 베끼지 말고 가리킨다. 끝나서 더는 상관없는 일은 뺀다. ' +
    '비밀값, 환경 변수 값, 긴 로그는 넣지 않는다. 사용자가 쓰는 말(한국어)로, 짧은 글머리표로 40줄 안쪽.',
]

export const HANDOFF_PROMPT = [
  '이 작업을 아무 맥락 없는 새 대화에서 이어 갈 수 있게 인계 메모를 써라.',
  '',
  ...BODY,
  '도구는 쓰지 않는다. 인계 메모만 답하고 인사말은 붙이지 않는다.',
].join('\n')

export const HANDOFF_FULL_PROMPT = [
  '이 작업을 아무 맥락 없는 새 대화에서 이어 갈 수 있게 인계 메모를 써라. 이번엔 도구를 써도 된다.',
  '',
  '1. 실제 상태를 확인한다: git status, 최근 커밋 몇 개, 브랜치를 push 했는지, gh 가 있으면 열린 PR.',
  '2. 프로젝트 최상위의 HANDOFF.md 를 처음부터 새로 쓴다(80줄 안쪽): 브랜치와 열린 PR, 덜 끝낸 일, 다음 할 일(첫 번째는 바로 할 수 있게), 사용자만 할 수 있는 일, 문서·계획·파일 위치. 비밀값은 넣지 않는다.',
  '3. 같은 모양으로 인계 메모 자체를 답한다:',
  '',
  ...BODY,
  '인계 메모만 답하고 인사말은 붙이지 않는다.',
].join('\n')

// 모델이 쓴 메모가 새 대화의 첫 사용자 메시지가 된다: 터미널 제어 문자열·숨은 문자(태그 문자 포함)를 지우고 길이를 묶는다.
const MEMO_MAX = 12_000
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
const HIDDEN = /[\u{E0000}-\u{E007F}\p{Cf}\p{Co}\p{Cs}]|[\x00-\x08\x0b-\x1f\x7f]/gu

export function safeMemo(text: string): string {
  const cleaned = text.replace(ESCAPES, '').replace(HIDDEN, '').trim()
  return cleaned.length > MEMO_MAX ? `${cleaned.slice(0, MEMO_MAX)}\n…(길어서 잘림)` : cleaned
}

/** 새 대화의 첫 메시지: 인계 메모 + 그다음 할 일. */
export function handoffMessage(handoff: string, after: HandoffAfter, isFull: boolean): string {
  const ask =
    after === 'confirm'
      ? '읽고 나서 지금 어디까지 왔고 다음이 뭔지 두 줄로 말한 뒤 내 말을 기다려 줘.'
      : '다음 할 일을 이어서 해 줘. "사용자 필요" 단계면 무엇이 필요한지 말하고 기다려 줘.'
  const saved = isFull ? '\n\n(지난 대화가 HANDOFF.md 도 새로 써 뒀어. 필요하면 먼저 읽어.)' : ''
  return `지난 대화에서 넘어온 인계 메모:\n\n${handoff.trim()}${saved}\n\n${ask}`
}

// 인계 추천: 대화가 30% 넘게 차면 질문 두 번마다 Haiku 에게 묻는다. 애매하면 "아니요" — 잘못된 "예"가 놓친 "예"보다 비싸다.
export const HINT_FROM_PERCENT = 30
export const HINT_EVERY = 2

export const HINT_SYSTEM = `You decide whether the person should hand off now: start a fresh chat that carries over a short summary, instead of carrying on in this one. You are shown what the chat was for, the trail of what the person asked, the last reply, the next message and how full the context is.

Say yes only for a clear reason: the task just finished and the next message is something else, the topic has changed so the old context is dead weight, the chat keeps going in circles on the same problem, or a long chat now holds so much unrelated history that a clean start would be sharper. A normal next step of the same work is never a reason, a long chat by itself is not one, and neither is a high context share when the work is going well. When unsure, say no.

Reply with JSON only: {"handoff":"reason in Korean, at most 8 words"} for yes, or {"handoff":null} for no.`

type Row = { role: string; text: string }

export function hintEvidence(messages: readonly Row[], next: string, percent: number): string {
  const asked = messages.filter(m => m.role === 'user' && m.text.trim())
  const first = asked[0]?.text.slice(0, 500) ?? ''
  const trail = asked.slice(-8, -1).map(m => `- ${m.text.slice(0, 160).replace(/\s+/g, ' ')}`)
  const reply = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text.slice(-700) ?? ''
  return [
    first ? `What the chat was for (first message):\n${first}` : '',
    trail.length ? `Trail of earlier messages:\n${trail.join('\n')}` : '',
    reply ? `The assistant's last reply (its end):\n${reply}` : '',
    `Next message:\n${next.slice(0, 600)}`,
    `Context used: ${Math.round(percent)}% of the window; ${asked.length} messages so far.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** 이유(넘기자) 또는 null(그대로). 읽을 수 없으면 undefined. */
export function parseHint(text: string): string | null | undefined {
  const raw = firstJsonObject(text)
  if (!raw || !('handoff' in raw)) return undefined
  return typeof raw.handoff === 'string' && raw.handoff.trim() ? raw.handoff.trim().slice(0, 60) : null
}
