// tree 시험: 순수 함수(경로·git 읽기·크기 그림)와 창(누르기 → 버튼 줄 → 절대 경로 복사).
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { codeOf, gitVerbs, parseNumstat, parseStatus, splitDiff } from '../hooks/git'
import { cells, fit, idOf, nativePath, norm, relativeTo, resolvePath } from '../hooks/paths'
import { layout, paint } from '../hooks/treemap'

test('경로를 맞추고 윈도우 경로는 \\ 로 복사한다', () => {
  expect(norm('C:\\Users\\me\\proj\\')).toBe('C:/Users/me/proj')
  expect(norm('C:\\')).toBe('C:/')
  expect(idOf('C:/Users/Me/A.ts')).toBe('c:/users/me/a.ts')
  expect(nativePath('C:/Users/me/a.ts')).toBe('C:\\Users\\me\\a.ts')
  expect(nativePath('/home/me/a.ts')).toBe('/home/me/a.ts')
  expect(relativeTo('C:/Users/me/proj', 'c:/users/me/proj/src/a.ts')).toBe('src/a.ts')
  expect(relativeTo('/a/b', '/a/bc/d')).toBe('')
  expect(resolvePath('/home/me/proj', '../x/./y.ts')).toBe('/home/me/x/y.ts')
  expect(resolvePath('C:/p', 'C:\\q\\r.ts')).toBe('C:/q/r.ts')
})

test('한글은 2칸으로 세고 칸에 맞춰 자른다', () => {
  expect(cells('가a')).toBe(3)
  expect(fit('abc', 5)).toBe('abc  ')
  expect(fit('가나다라', 5)).toBe('가나…')
  expect(cells(fit('가나다라마바', 7))).toBe(7)
})

test('git status 출력을 읽는다', () => {
  const out = ['## main...origin/main [ahead 2, behind 1]', ' M src/a.ts', '?? new.txt', 'R  b2.ts', 'b1.ts', ' D gone.ts', ''].join('\0')
  const s = parseStatus(out, 'C:/proj')
  expect(s.branch).toBe('main')
  expect(s.upstream).toBe('origin/main')
  expect(s.ahead).toBe(2)
  expect(s.behind).toBe(1)
  expect(s.files['c:/proj/src/a.ts']).toBe('M')
  expect(s.files['c:/proj/new.txt']).toBe('?')
  expect(s.files['c:/proj/b2.ts']).toBe('R')
  expect(s.files['c:/proj/b1.ts']).toBeUndefined()
  expect(s.files['c:/proj/gone.ts']).toBe('D')
  expect(s.paths['c:/proj/src/a.ts']).toBe('C:/proj/src/a.ts')
  expect(codeOf('AM')).toBe('A')
  const lines = parseNumstat(['3\t1\tsrc/a.ts', '-\t-\timg.png', ''].join('\0'), '/p')
  expect(lines['/p/src/a.ts']).toEqual([3, 1])
  expect(lines['/p/img.png']).toEqual([0, 0])
})

test('셸 명령에서 바꾸는 git 동작만 고른다', () => {
  expect(gitVerbs('git add . && git commit -m "x" && git push')).toEqual(['커밋', '푸시'])
  expect(gitVerbs('git status; git log --oneline')).toEqual([])
  expect(gitVerbs('git -C /p commit -m y')).toEqual(['커밋'])
  expect(gitVerbs('gh pr create --fill')).toEqual(['PR 열기'])
  expect(gitVerbs('ls -la')).toEqual([])
})

test('diff 를 파일별로 나눈다', () => {
  const patch = [
    'diff --git a/a.ts b/a.ts',
    'index 1..2 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,2 @@',
    ' keep',
    '-old',
    '+new',
    'diff --git a/b.png b/b.png',
    'Binary files a/b.png and b/b.png differ',
    '',
  ].join('\n')
  const files = splitDiff(patch)
  expect(files.length).toBe(2)
  expect(files[0]?.title).toBe('a.ts')
  expect(files[0]?.add).toBe(1)
  expect(files[0]?.del).toBe(1)
  expect(files[0]?.source.startsWith('@@')).toBe(true)
  expect(files[1]?.source).toBe('(바이너리 파일이 바뀜)')
})

test('크기 그림은 칸을 빠짐없이 나누고 Raster 칸 수가 맞다', () => {
  const rects = layout([50, 30, 20], 40, 10)
  expect(rects.length).toBe(3)
  const area = rects.reduce((s, r) => s + r.w * r.h, 0)
  expect(Math.round(area)).toBe(400)
  const big = rects.find(r => r.index === 0)
  expect(Math.round((big?.w ?? 0) * (big?.h ?? 0))).toBe(200)
  const b64 = paint(rects, [0xff0000, 0x00ff00, 0x0000ff], ['src', '한글', 'x'], 40, 10)
  // 40*10 칸 × 3 단어 × 4바이트 → base64 길이
  expect(b64.length).toBe(Math.ceil((40 * 10 * 12) / 3) * 4)
})

// ── 창 ──

const ROOT = '/proj'

function fakeEngine(on: On, copied: string[], toasts: string[]) {
  mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }) as never)
  on('session.cwd', () => ({ value: ROOT }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.scroll', () => ({ value: undefined }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined } as never
  })
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('fs.list', (_$, e) => {
    const path = String((e as { path?: unknown }).path ?? '').replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    const entries =
      path === ROOT
        ? [
            { name: 'src', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
            { name: 'README.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false },
          ]
        : path === `${ROOT}/src`
          ? [{ name: 'a.ts', kind: 'file', size: 5, mtimeMs: 0, isLink: false }]
          : []
    return { value: entries } as never
  })
}

const PANE = {
  plugin: 'tree',
  component: 'Pane',
  requestId: 'tree',
  props: { title: '파일', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('폴더를 누르면 펼치고, 파일을 누르면 버튼 줄이 생기고, 경로 복사는 절대 경로', async ($, on) => {
  const copied: string[] = []
  const toasts: string[] = []
  fakeEngine(on, copied, toasts)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const shown = async () => JSON.stringify(await ui.drawn())
  expect(await shown()).toContain('README.md')
  expect(await shown()).not.toContain('a.ts')

  await ui.press({ key: `b:${ROOT}/src` })
  expect(await shown()).toContain(`b:${ROOT}/src/a.ts`)

  await ui.press({ key: `b:${ROOT}/src/a.ts` })
  expect(await shown()).toContain(`copy:${ROOT}/src/a.ts`)
  expect(await shown()).toContain(`peek:${ROOT}/src/a.ts`)

  await ui.press({ key: `copy:${ROOT}/src/a.ts` })
  expect(copied).toEqual([`${ROOT}/src/a.ts`])
  expect(toasts.some(t => t.includes('경로를 복사했습니다'))).toBe(true)
  await ui.unmount()
})

test('사람이 보지 않는 세션에선 도구 호출을 건드리지 않는다', async ($, on) => {
  const copied: string[] = []
  const toasts: string[] = []
  fakeEngine(on, copied, toasts)
  const reads: string[] = []
  on('fs.exists', (_$, e) => {
    reads.push(String((e as { path?: unknown }).path ?? ''))
    return { value: true } as never
  })
  on('tool.call', () => ({ result: {} }) as never)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/x.ts`, content: 'x' })
  expect(reads).toEqual([])
})
