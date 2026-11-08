// 셸 명령으로 읽은 파일 찾기: 순수 함수(명령 글자 → 경로)와 도구 호출 뒤 보라(읽기) 표시.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { outputPaths, shellReadPaths } from '../hooks/shellreads'

const CWD = '/proj'
const reads = (command: string, cwd = CWD) => shellReadPaths(command, cwd)

test('cat·head·sed -n 같은 읽기 명령의 파일 인자를 고르고 파이프·&& 를 나눈다', () => {
  expect(reads('cat a.txt | head -5')).toEqual(['/proj/a.txt'])
  expect(reads('head -n 20 src/a.ts; tail -f log.txt && wc -l b.md c.md')).toEqual(['/proj/src/a.ts', '/proj/log.txt', '/proj/b.md', '/proj/c.md'])
  expect(reads("sed -n '1,20p' x.ts")).toEqual(['/proj/x.ts'])
  expect(reads("awk -F, '{print $1}' data.csv")).toEqual(['/proj/data.csv'])
  expect(reads("jq -r '.name' package.json")).toEqual(['/proj/package.json'])
  expect(reads('nl -ba README.md')).toEqual(['/proj/README.md'])
})

test('cd 를 따라가고, 모르는 폴더로 가면 그 뒤는 버린다', () => {
  expect(reads('cd src && cat x.ts && sed -n 1p ../y.ts')).toEqual(['/proj/src/x.ts', '/proj/y.ts'])
  expect(reads('cd /abs/dir && cat x')).toEqual(['/abs/dir/x'])
  expect(reads('cd $DIR && cat x')).toEqual([])
})

test('grep·rg 는 첫 자리 말(패턴)과 옵션 값을 빼고 파일만 고른다', () => {
  expect(reads('grep -n "foo bar" README.md src/a.ts')).toEqual(['/proj/README.md', '/proj/src/a.ts'])
  expect(reads('grep -e foo -e bar a.ts')).toEqual(['/proj/a.ts'])
  expect(reads("rg -n -g '*.ts' -A 3 pattern src")).toEqual(['/proj/src'])
  expect(reads('rg --files src')).toEqual(['/proj/src'])
  expect(reads('grep -rn --include=*.ts foo .')).toEqual(['/proj'])
})

test('리다이렉트: > 는 쓰기라 빼고 < 는 읽기, sed -i 는 통째로 뺀다', () => {
  expect(reads('echo hi > out.txt')).toEqual([])
  expect(reads('cat a.txt > out.txt 2>/dev/null')).toEqual(['/proj/a.txt'])
  expect(reads('cat a.txt>out.txt')).toEqual(['/proj/a.txt'])
  expect(reads('sort < in.txt >> sorted.txt')).toEqual(['/proj/in.txt'])
  expect(reads("sed -i 's/a/b/' f.txt")).toEqual([])
  expect(reads("sed -ni 'p' f.txt")).toEqual([])
  expect(reads("sed --in-place=.bak 's/a/b/' f.txt")).toEqual([])
  expect(reads('cat a.txt | tee copy.txt')).toEqual(['/proj/a.txt'])
})

test('따옴표 안 빈칸·대괄호는 이름 그대로, 변수·와일드카드는 버린다', () => {
  expect(reads(`cat "my file.txt" 'x y.md' "app/[id]/page.tsx"`)).toEqual(['/proj/my file.txt', '/proj/x y.md', '/proj/app/[id]/page.tsx'])
  expect(reads('cat $HOME/x *.ts "$F"')).toEqual([])
  expect(reads('ls -la && echo cat.txt && python run.py a.txt')).toEqual([])
})

test('heredoc 본문과 $( ) 안은 명령으로 읽지 않는다', () => {
  expect(reads("cat > notes.md <<'EOF'\ncat secret.txt\nEOF\ncat after.txt")).toEqual(['/proj/after.txt'])
  expect(reads(`git commit -m "$(cat <<'EOF'\nmsg cat x.txt\nEOF\n)"`)).toEqual([])
  expect(reads('cat <<< "hello" && cat b.txt')).toEqual(['/proj/b.txt'])
  expect(reads('# cat a.txt\ncat b.txt')).toEqual(['/proj/b.txt'])
})

test('PowerShell: Get-Content·Select-String·type, 경로의 \\ 는 구분자', () => {
  const ps = (c: string) => shellReadPaths(c, 'C:/p', 'powershell')
  expect(ps('Get-Content -Path C:\\p\\a.txt -TotalCount 5; Select-String -Pattern foo -Path b.txt')).toEqual(['C:/p/a.txt', 'C:/p/b.txt'])
  expect(ps('type src\\x.ts | Select-Object -First 3')).toEqual(['C:/p/src/x.ts'])
  expect(ps('gc -Raw notes.md')).toEqual(['C:/p/notes.md'])
  expect(reads('type x.txt')).toEqual([])
})

test('grep -r·rg·find 의 출력에서 파일 경로를 고르고, 파이프나 경로 없는 출력은 버린다', () => {
  expect(outputPaths('grep -rn foo src', 'src/a.ts:3:foo\nsrc/b.ts:9:foo\n', CWD)).toEqual(['/proj/src/a.ts', '/proj/src/b.ts'])
  expect(outputPaths('grep -l foo a.ts b.ts', 'b.ts\n', CWD)).toEqual(['/proj/b.ts'])
  expect(outputPaths('grep foo a.ts', 'foo: x\n', CWD)).toEqual([])
  expect(outputPaths('rg foo', 'a.ts:1:foo\n', CWD)).toEqual(['/proj/a.ts'])
  expect(outputPaths("find . -name '*.md'", './x.md\n./d/y.md\n', CWD)).toEqual(['/proj/x.md', '/proj/d/y.md'])
  expect(outputPaths('find . -name x -delete', './x\n', CWD)).toEqual([])
  expect(outputPaths('grep -r foo . | head', './a.ts:foo\n', CWD)).toEqual([])
  expect(outputPaths('rg foo', Array.from({ length: 100 }, (_, i) => `f${i}.ts:1:x`).join('\n'), CWD).length).toBe(30)
})

// ── 도구 호출 뒤 표시 ──

const READ = '#a78bfa'
const WRITE = '#f59e42'
const FILES = new Set(['/proj/README.md', '/proj/src/a.ts', '/proj/CLAUDE.md', '/proj/node_modules/x.js'])

function fakeShellEngine(on: On, stdout: string, writes: () => string[]): void {
  mock.clock(on)
  let writtenAt = 0
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: CWD }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.scroll', () => ({ value: undefined }) as never)
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.list', (_$, e) => {
    const path = String((e as { path?: unknown }).path ?? '')
    if (path !== CWD) return { value: [] } as never
    const names = ['README.md', 'CLAUDE.md']
    return { value: names.map(name => ({ name, kind: 'file', size: 1, mtimeMs: writes().includes(name) ? writtenAt : 1, isLink: false })) } as never
  })
  on('fs.stat', (_$, e) => {
    const path = String((e as { path?: unknown }).path ?? '')
    return { value: FILES.has(path) ? { kind: 'file', size: 1, mtimeMs: 1, isLink: false } : { kind: 'other', size: 0, mtimeMs: 0, isLink: false } } as never
  })
  on('tool.call', () => {
    writtenAt = Date.now()
    return { result: { stdout, stderr: '', interrupted: false } } as never
  })
}

const PANE = {
  plugin: 'tree',
  component: 'Pane',
  requestId: 'tree',
  props: { title: 'tree', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** 그려진 트리에서 이름 글자를 칠한 색들. */
function colorsOf(drawn: unknown, name: string): string[] {
  const found: string[] = []
  const walk = (node: unknown, color?: string): void => {
    if (typeof node === 'string') {
      if (node.trim() === name && color) found.push(color)
      return
    }
    if (!node || typeof node !== 'object') return
    const props = (node as { props?: Record<string, unknown> }).props ?? {}
    const own = typeof props.color === 'string' ? props.color : color
    for (const v of Object.values(node as Record<string, unknown>)) walk(v, own)
  }
  walk(drawn)
  return found
}

test('Bash 로 읽은 파일(인자·grep 출력)은 보라, 숨김·없는 파일은 빼고', async ($, on) => {
  fakeShellEngine(on, 'src/a.ts:1:x\nnode_modules/x.js:2:x\n', () => [])
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(colorsOf(await ui.drawn(), 'README.md')).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'cat README.md missing.txt' })
  await $.tool.call({ tool: 'Bash', command: 'grep -rn x .' })
  const drawn = await ui.drawn()
  expect(colorsOf(drawn, 'README.md')).toContain(READ)
  await ui.unmount()
})

test('같은 명령이 쓴 파일은 읽기가 아니라 쓰기(주황)로 남는다', async ($, on) => {
  fakeShellEngine(on, '', () => ['CLAUDE.md'])
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.tool.call({ tool: 'Bash', command: 'cat README.md CLAUDE.md > CLAUDE.md.tmp && cp CLAUDE.md.tmp CLAUDE.md && cat CLAUDE.md' })
  const drawn = await ui.drawn()
  expect(colorsOf(drawn, 'CLAUDE.md')).toContain(WRITE)
  expect(colorsOf(drawn, 'CLAUDE.md')).not.toContain(READ)
  expect(colorsOf(drawn, 'README.md')).toContain(READ)
  await ui.unmount()
})
