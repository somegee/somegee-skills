// 셸 명령 글자를 말(word) 단위로 자르는 순수 함수. 진짜 셸만큼 정확하진 않고, '읽은 파일 찾기'에 쓸 만큼만.
// 따옴표·역슬래시·$( )·주석·heredoc 본문을 알고, | || && ; & 줄바꿈 ( ) 에서 명령을 나눈다.

export type Word = { word: string; isPlain: boolean }
type Tok = { op: string } | Word
export type Shell = 'bash' | 'powershell'

const SPLIT_OPS = new Set(['|', ';', '&', '\n', '(', ')'])

/** 명령 줄 → 명령 하나씩의 말 목록. heredoc 본문은 버린다. */
export function simpleCommands(command: string, shell: Shell = 'bash'): Word[][] {
  const out: Word[][] = [[]]
  for (const t of tokenize(dropHeredocs(command), shell)) {
    if ('op' in t) out.push([])
    else out[out.length - 1]?.push(t)
  }
  return out.filter(words => words.length > 0)
}

/** '<<EOF' 뒤 본문 줄을 지운다(본문 글자를 명령으로 읽지 않게). '<<<' 는 heredoc 이 아니다. */
export function dropHeredocs(command: string): string {
  const kept: string[] = []
  let end: string | null = null
  for (const line of command.split('\n')) {
    if (end !== null) {
      if (line.trim() === end) end = null
      continue
    }
    const m = /(?<!<)<<-?(?!<)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    kept.push(m ? line.slice(0, m.index) : line)
    if (m) end = m[2] ?? null
  }
  return kept.join('\n')
}

type Cursor = { toks: Tok[]; cur: string; isPlain: boolean; has: boolean }

function flush(c: Cursor): void {
  if (c.has) c.toks.push({ word: c.cur, isPlain: c.isPlain })
  c.cur = ''
  c.isPlain = true
  c.has = false
}

/** 따옴표 안 글자를 붙이고 닫는 따옴표 자리를 돌려준다. */
function takeQuoted(s: string, i: number, c: Cursor): number {
  const close = s.indexOf(s[i] as string, i + 1)
  const end = close < 0 ? s.length : close
  c.cur += s.slice(i + 1, end)
  c.isPlain = false
  c.has = true
  return end
}

/** '$(' 부터 짝 맞는 ')' 까지를 말에 붙인다(치환은 펼치지 않음 — '$' 가 들어가 나중에 버려진다). */
function takeSubst(s: string, i: number, c: Cursor): number {
  let depth = 0
  let end = s.length - 1
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '(') depth++
    else if (s[j] === ')' && --depth === 0) {
      end = j
      break
    }
  }
  c.cur += s.slice(i, end + 1)
  c.has = true
  return end
}

function opAt(s: string, i: number): string | null {
  const two = s.slice(i, i + 2)
  if (two === '&&' || two === '||' || two === '|&') return two
  const ch = s[i] as string
  if (ch === '&' && (s[i + 1] === '>' || s[i - 1] === '>')) return null
  return SPLIT_OPS.has(ch) ? ch : null
}

/** 한 글자를 보고 커서를 옮긴다. 돌려준 값은 다음에 볼 자리 - 1. */
function step(s: string, i: number, c: Cursor, shell: Shell): number {
  const ch = s[i] as string
  if (ch === "'" || ch === '"') return takeQuoted(s, i, c)
  if (ch === '\\' && shell === 'bash' && i + 1 < s.length) {
    if (s[i + 1] !== '\n') {
      c.cur += s[i + 1]
      c.has = true
    }
    return i + 1
  }
  if (ch === '$' && s[i + 1] === '(') return takeSubst(s, i, c)
  if (ch === ' ' || ch === '\t' || ch === '\r') {
    flush(c)
    return i
  }
  const op = opAt(s, i)
  if (op) {
    flush(c)
    c.toks.push({ op })
    return i + op.length - 1
  }
  if (ch === '#' && !c.has) return Math.max(i, s.indexOf('\n', i) < 0 ? s.length - 1 : s.indexOf('\n', i) - 1)
  // 'a.txt>out' 처럼 붙은 리다이렉트는 앞 말과 떼어 놓는다('2>' · '&>' 는 그대로)
  if ((ch === '>' || ch === '<') && c.has && !/^(\d+|&|[<>]+)$/.test(c.cur)) flush(c)
  c.cur += ch
  c.has = true
  return i
}

/** 따옴표·역슬래시를 아는 단순한 셸 말 자르기. 연산자는 { op } 로. PowerShell 에선 '\' 가 경로 구분이다. */
export function tokenize(command: string, shell: Shell = 'bash'): Tok[] {
  const c: Cursor = { toks: [], cur: '', isPlain: true, has: false }
  for (let i = 0; i < command.length; i++) i = step(command, i, c, shell)
  flush(c)
  return c.toks
}
