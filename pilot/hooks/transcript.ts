// 대화를 요약자(Haiku)가 읽을 글로. 마지막 몇 개는 거의 통째로(지금 하던 일이 거기 있다), 앞쪽 도구 결과는 줄여서.
// effortless(HeyCubit, MIT)의 compactTranscript 를 옮겼다. NOTICE 참고.

export const TAIL = 6
const TAIL_CHARS = 20_000
export const TRANSCRIPT_MAX_CHARS = 2_400_000

type Row = {
  role: string
  text: string
  toolUses?: readonly { tool: string; input: unknown; text?: string }[]
  toolResults?: readonly { text?: string }[]
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} …[${s.length - n}자 생략]` : s)

export function transcriptText(messages: readonly Row[], toolChars = 2000, tailChars = TAIL_CHARS): string {
  const tailFrom = messages.length - TAIL
  return messages
    .map((m, i) => {
      const inTail = i >= tailFrom
      const inputChars = inTail ? tailChars : 400
      const resultChars = inTail ? tailChars : toolChars
      const lines = [`${m.role === 'user' ? 'USER' : 'CLAUDE'}: ${m.text}`.trimEnd()]
      for (const t of m.toolUses ?? []) {
        lines.push(`  [${t.tool} ${cut(JSON.stringify(t.input ?? {}), inputChars)}]`)
        if (t.text) lines.push(`  → ${cut(t.text, resultChars)}`)
      }
      if (!m.toolUses?.length) for (const r of m.toolResults ?? []) if (r.text) lines.push(`  → ${cut(r.text, resultChars)}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/** 너무 길면 한 번 더 줄이고, 그래도 넘치면 undefined. */
export function fittedTranscript(messages: readonly Row[]): string | undefined {
  let text = transcriptText(messages)
  if (text.length > TRANSCRIPT_MAX_CHARS) text = transcriptText(messages, 300, 4000)
  return text.length > TRANSCRIPT_MAX_CHARS ? undefined : text
}
