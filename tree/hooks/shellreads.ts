// 셸 명령에서 '읽기만 하는' 파일을 찾는 순수 함수. $ 를 쓰지 않아 테스트에서 바로 부른다.
// Grep·Glob 도구가 없는 세션의 Claude 는 cat·sed -n·grep·rg 로 읽는다 → 그 파일도 보라(읽기)로 칠하려고.
// 쓰기(> 리다이렉트·sed -i·tee)는 고르지 않는다 — 쓰기는 activity.ts 가 수정 시각으로 따로 찾고, 쓰기가 이긴다.
import { resolvePath } from './paths'
import { simpleCommands, type Shell, type Word } from './shellwords'

export type { Shell } from './shellwords'

/** values: 뒤 값을 하나 먹는 옵션(그 값은 파일이 아니다). pattern: 첫 자리 말이 패턴(파일 아님). */
type Spec = {
  values: readonly string[]
  pattern?: { flags: readonly string[]; none?: readonly string[] }
  isWrite?: (flags: readonly string[]) => boolean
}

const NONE: Spec = { values: [] }
const HEAD: Spec = { values: ['-n', '-c', '--lines', '--bytes', '-s', '--sleep-interval', '--pid'] }
const NL: Spec = { values: ['-b', '-d', '-f', '-h', '-i', '-l', '-n', '-s', '-v', '-w'] }
const BAT: Spec = { values: ['-r', '--line-range', '-l', '--language', '-H', '--highlight-line', '--theme', '--style', '-m', '--map-syntax', '--tabs', '--wrap', '--terminal-width', '--color', '--paging'] }
const DIFF: Spec = { values: ['-U', '-L', '--label', '-x', '-X', '-I'] }
const XXD: Spec = { values: ['-l', '-s', '-c', '-g', '-o', '-n', '-N', '-j', '-t', '-A', '-w', '-S'] }
const CUT: Spec = { values: ['-d', '-f', '-c', '-b', '--delimiter', '--fields', '--characters', '--bytes', '--output-delimiter'] }
const PATTERN_FLAGS = ['-e', '-f', '--regexp', '--file']
const GREP: Spec = {
  values: ['-e', '-f', '-m', '-A', '-B', '-C', '-d', '-D', '--regexp', '--file', '--max-count', '--context', '--after-context', '--before-context', '--include', '--exclude', '--exclude-dir', '--color', '--colour', '--label', '--binary-files'],
  pattern: { flags: PATTERN_FLAGS },
}
const RG: Spec = {
  values: ['-e', '-f', '-m', '-A', '-B', '-C', '-g', '-t', '-T', '-j', '-M', '-r', '-E', '-d', '--regexp', '--file', '--max-count', '--context', '--after-context', '--before-context', '--glob', '--iglob', '--type', '--type-not', '--replace', '--encoding', '--threads', '--max-columns', '--max-depth', '--max-filesize', '--sort', '--sortr', '--color', '--colors', '--type-add', '--pre', '--engine'],
  pattern: { flags: PATTERN_FLAGS, none: ['--files', '--type-list'] },
}
/** sed -i(·-ni·--in-place) 는 파일을 고쳐 쓴다 → 읽기로 치지 않는다. */
const SED: Spec = {
  values: ['-e', '-f', '-l', '--expression', '--file', '--line-length'],
  pattern: { flags: ['-e', '-f', '--expression', '--file'] },
  isWrite: flags => flags.some(f => f.startsWith('--in-place') || (/^-[^-]/.test(f) && f.slice(1).includes('i'))),
}
const AWK: Spec = { values: ['-F', '-v', '-f'], pattern: { flags: ['-f'] } }
const JQ: Spec = { values: ['--indent', '-f', '--from-file', '-L'], pattern: { flags: ['-f', '--from-file'] } }
const PS_GET: Spec = { values: ['-totalcount', '-head', '-first', '-tail', '-last', '-encoding', '-delimiter', '-readcount', '-stream', '-filter', '-include', '-exclude'] }
const PS_SELECT: Spec = { values: ['-pattern', '-context', '-encoding', '-include', '-exclude'], pattern: { flags: ['-pattern'] } }
/** 뒤 값을 둘 먹는 옵션(jq --arg 이름 값). */
const TWO_VALUES = new Set(['--arg', '--argjson', '--slurpfile', '--rawfile'])

const BASH_READERS: Readonly<Record<string, Spec>> = {
  cat: NONE, tac: NONE, less: NONE, more: NONE, wc: NONE, cmp: NONE, head: HEAD, tail: HEAD, nl: NL,
  bat: BAT, batcat: BAT, diff: DIFF, xxd: XXD, od: XXD, strings: XXD, cut: CUT,
  grep: GREP, egrep: GREP, fgrep: GREP, rg: RG, sed: SED, awk: AWK, gawk: AWK, jq: JQ,
}
const PS_READERS: Readonly<Record<string, Spec>> = {
  ...BASH_READERS,
  'get-content': PS_GET, gc: PS_GET, type: PS_GET, 'select-string': PS_SELECT, sls: PS_SELECT,
}
/** PowerShell 에서 경로를 받는 이름 붙은 옵션. */
const PS_PATH_FLAGS = new Set(['-path', '-literalpath'])
const CD_NAMES = new Set(['cd', 'pushd', 'set-location', 'sl', 'chdir'])
/** 앞에 붙어도 실제 명령은 뒤에 있는 말들. */
const WRAPPERS = new Set(['sudo', 'command', 'time', 'nohup', 'exec', 'nice'])
/** 셸이 펼친 뒤에야 알 수 있는 말(변수·치환·와일드카드)은 버린다. */
const UNRESOLVED = /[$`*?[\]{}]/
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const PATH_LIMIT = 40
const OUTPUT_LINES = 400

/** 셸 명령이 읽는 파일의 절대 경로(중복 없이, 많아야 40개). 'cd 폴더 &&' 는 따라간다. */
export function shellReadPaths(command: string, cwd: string, shell: Shell = 'bash', home = ''): string[] {
  const readers = shell === 'powershell' ? PS_READERS : BASH_READERS
  const out = new Set<string>()
  let dir: string | null = cwd
  for (const words of simpleCommands(command, shell)) {
    const { args, inputs } = splitRedirects(words)
    const plain = stripPrefix(args)
    const name = commandName(plain[0], shell)
    if (CD_NAMES.has(name)) {
      dir = nextDir(dir, plain[1], home)
      continue
    }
    if (dir === null) continue
    const spec = readers[name]
    const files = spec ? argFiles(plain.slice(1), spec, shell) : []
    for (const path of [...inputs, ...files]) out.add(resolvePath(dir, path, home))
  }
  return [...out].slice(0, PATH_LIMIT)
}

/** grep -r·-l·rg·find 의 출력에서 파일 경로를 고른다(명령 하나짜리일 때만). 'a.ts:12:…' → a.ts. */
export function outputPaths(command: string, stdout: string, cwd: string, home = '', limit = 30): string[] {
  const parts = simpleCommands(command)
  if (parts.length !== 1) return []
  const plain = stripPrefix(splitRedirects(parts[0] ?? []).args)
  const kind = outputKind(plain)
  if (!kind) return []
  const out = new Set<string>()
  for (const line of stdout.split('\n').slice(0, OUTPUT_LINES)) {
    const path = kind === 'find' ? line.trim() : grepPathOf(line)
    if (path) out.add(resolvePath(cwd, path, home))
    if (out.size >= limit) break
  }
  return [...out]
}

/** 출력 줄이 파일 경로로 시작하는 명령인가. grep 은 -r·-l·-H 같은 것이 있을 때만(아니면 줄에 경로가 없다). */
function outputKind(plain: readonly Word[]): 'find' | 'grep' | null {
  const name = commandName(plain[0], 'bash')
  const flags = plain.slice(1).filter(w => w.isPlain && w.word.startsWith('-')).map(w => w.word)
  if (name === 'find') return flags.some(f => f.startsWith('-exec') || f === '-delete' || f.startsWith('-ok') || f.startsWith('-fprint')) ? null : 'find'
  if (name === 'rg') return 'grep'
  if (name !== 'grep' && name !== 'egrep' && name !== 'fgrep') return null
  const isNamed = flags.some(f => /^-[^-]*[rRlLH]/.test(f) || ['--recursive', '--dereference-recursive', '--files-with-matches', '--files-without-match', '--with-filename'].includes(f))
  return isNamed ? 'grep' : null
}

function grepPathOf(line: string): string {
  const skip = /^[A-Za-z]:[\\/]/.test(line) ? 2 : 0
  const cut = line.indexOf(':', skip)
  const head = (cut < 0 ? line : line.slice(0, cut)).trim()
  return head === '' || head.startsWith('Binary file') || head.includes('\0') ? '' : head
}

function nextDir(dir: string | null, target: Word | undefined, home: string): string | null {
  if (dir === null || !target || target.word === '-' || UNRESOLVED.test(target.word)) return null
  return resolvePath(dir, target.word, home)
}

function commandName(first: Word | undefined, shell: Shell): string {
  if (!first) return ''
  const base = first.word.split(shell === 'powershell' ? /[\\/]/ : '/').pop() ?? ''
  return base.toLowerCase().replace(/\.exe$/, '')
}

/** 앞쪽 'A=1' 환경값과 sudo·time 같은 감싸개를 걷어 낸다. */
function stripPrefix(words: readonly Word[]): Word[] {
  let i = 0
  while (i < words.length && (ASSIGN.test(words[i]?.word ?? '') || WRAPPERS.has(words[i]?.word ?? ''))) i++
  return words.slice(i)
}

/** 리다이렉트를 떼어 낸다. '< 파일' 은 읽기로 모으고 '> 파일'·'2>&1'·'<<<' 는 버린다. */
function splitRedirects(words: readonly Word[]): { args: Word[]; inputs: string[] } {
  const args: Word[] = []
  const inputs: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word
    const m = w.isPlain ? /^(\d*|&)(>>?|>\||<<<|<)(.*)$/.exec(w.word) : null
    if (!m) {
      args.push(w)
      continue
    }
    const target = m[3] ? { word: m[3], isPlain: true } : words[++i]
    if (m[2] === '<' && target && isUsable(target)) inputs.push(target.word)
  }
  return { args, inputs }
}

/** 따옴표 안 말은 '[id]' 같은 이름도 그대로 쓴다(펼쳐지지 않으므로). '$'·'`' 는 따옴표 안에서도 펼쳐진다. */
function isUsable(w: Word): boolean {
  const unresolved = w.isPlain ? UNRESOLVED : /[$`]/
  return w.word !== '' && w.word !== '-' && !unresolved.test(w.word) && !w.word.startsWith('&') && !w.word.startsWith('/dev/') && !/[\n<>|]/.test(w.word)
}

function flagOf(w: Word, shell: Shell): string {
  return shell === 'powershell' ? w.word.toLowerCase() : w.word
}

/** 옵션·옵션 값·패턴을 빼고 남는 말(파일 후보). */
function argFiles(args: readonly Word[], spec: Spec, shell: Shell): string[] {
  const flags = args.filter(w => w.isPlain && w.word.startsWith('-')).map(w => flagOf(w, shell))
  if (spec.isWrite?.(flags)) return []
  const p = spec.pattern
  let needsPattern = Boolean(p) && !flags.some(f => p?.flags.includes(f.split('=')[0] ?? f) || p?.none?.includes(f))
  const files: string[] = []
  let isOptionsDone = false
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as Word
    const flag = flagOf(w, shell)
    if (!isOptionsDone && w.isPlain && flag.startsWith('-') && flag.length > 1) {
      if (flag === '--') isOptionsDone = true
      else if (shell === 'powershell' && PS_PATH_FLAGS.has(flag)) files.push(...splitList(args[++i]))
      else if (TWO_VALUES.has(flag)) i += 2
      else if (spec.values.includes(flag)) i += 1
      continue
    }
    if (needsPattern) needsPattern = false
    else if (isUsable(w) && !ASSIGN.test(w.word)) files.push(w.word)
  }
  return files
}

/** PowerShell '-Path a.txt,b.txt'. */
function splitList(w: Word | undefined): string[] {
  if (!w || !isUsable(w)) return []
  return w.word.split(',').map(s => s.trim()).filter(Boolean)
}
