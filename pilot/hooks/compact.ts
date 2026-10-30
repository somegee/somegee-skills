// 압축을 고른 모델(Haiku·Sonnet·Opus)로: compactModel 이 '원래대로'가 아닐 때만 훅을 단다(회사 PC 보안 모듈이 session.compact 를 막아 알림이 뜨므로).
// 요약 지시는 effortless(HeyCubit, MIT)의 COMPACT_SYSTEM 을 따른다. NOTICE 참고.
import type { EngineInterface, SessionCompactInput, SessionCompactResult } from 'claude-code'

import { MODELS, askModel } from './haiku'
import type { ModelKey } from './haiku'
import { T } from './text'
import { fittedTranscript } from './transcript'

const COMPACT_TIMEOUT_MS = 240_000
const COMPACT_MAX_TOKENS = 16_000
const MIN_SUMMARY_CHARS = 200

export const COMPACT_SYSTEM = `You compact a conversation between a user and Claude Code, an AI coding agent, so the work can continue in a fresh context that holds only your summary. Whoever reads it next knows nothing else about the conversation. Write in the language the user writes in.

Write a detailed summary with these sections:
1. Primary request and intent: everything the user asked for, in detail, including changes of mind.
2. Key technical concepts: technologies, frameworks, constraints and decisions.
3. Files and code: every file read, created or edited, why it matters, and the important snippets or signatures.
4. Errors and fixes: what went wrong, how it was fixed, and any feedback the user gave about it.
5. Problem solving: what was solved and what is still being worked out.
6. All user messages: every message the user wrote that is not a tool result, briefly and in order.
7. Pending tasks: what the user asked for that is not done.
8. Current work: exactly what was being done right before this summary, with file names and code. The last few messages come nearly uncut: carry the code and errors from them over in full, since the next step builds on them.
9. Next step: the next step, only if it follows directly from the user's latest request, quoting that request.

Never include secrets or environment values.`

const continueNote = (key: ModelKey) =>
  `이 세션은 컨텍스트가 차서 앞부분을 요약하고 이어 가는 중이다. 아래 요약은 pilot 이 ${MODELS[key].label} 로 썼다.`

type Next = (e: SessionCompactInput) => Promise<SessionCompactResult>

export async function compactWith($: EngineInterface, e: SessionCompactInput, next: Next, key: ModelKey): Promise<SessionCompactResult> {
  // 하위 에이전트의 압축은 원래대로. 미리 만들어 두는 요약은 쓰이지 않으니 건너뛴다.
  if (e.agentId !== undefined) return next(e)
  if (e.trigger === 'precompute') return { skip: `pilot 은 때가 되면 ${MODELS[key].label} 로 압축합니다` }
  const messages = e.messages.length ? e.messages : await $.session.messages().catch(() => [])
  const transcript = fittedTranscript(messages)
  if (!transcript) return fallback($, e, next, key, '대화가 너무 김')
  const note = e.instructions?.trim() ? `\n사용자가 요약에서 꼭 남기라고 한 것: ${e.instructions.trim()}` : ''
  const got = await askModel($, key, {
    system: COMPACT_SYSTEM,
    prompt: `${transcript}\n\n---\nWrite the summary now.${note}`,
    maxTokens: COMPACT_MAX_TOKENS,
    timeoutMs: COMPACT_TIMEOUT_MS,
    effort: 'medium',
  })
  if ('fail' in got) return fallback($, e, next, key, got.fail)
  if (got.text.trim().length < MIN_SUMMARY_CHARS) return fallback($, e, next, key, '요약이 비어 있음')
  return {
    messages: [
      {
        role: 'user' as const,
        text: `${continueNote(key)}\n\n${got.text.trim()}\n\n사용자에게 더 묻지 말고 하던 곳에서 이어 가라.`,
        toolUses: [],
      },
    ],
  }
}

function fallback($: EngineInterface, e: SessionCompactInput, next: Next, key: ModelKey, why: string): Promise<SessionCompactResult> {
  $.ui.toast(T.compactFailed(MODELS[key].label, why))
  return next(e)
}
