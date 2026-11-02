// 경로·글자 폭·크기 표기 같은 순수 함수. $ 를 쓰지 않아 테스트에서 바로 부를 수 있다.

/** 경로를 '/' 구분, 끝 '/' 없이 맞춘다. 드라이브 루트는 'C:/' 로 둔다. */
export function norm(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[A-Za-z]:$/.test(slashed)) return `${slashed}/`
  return slashed === '' && path.startsWith('/') ? '/' : slashed
}

/** 윈도우 경로(드라이브 문자)인가. */
export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path)
}

/** 비교용 열쇠: 윈도우는 대소문자를 가리지 않으므로 소문자로. */
export function idOf(path: string): string {
  const p = norm(path)
  return isWindowsPath(p) ? p.toLowerCase() : p
}

export function join(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

export function baseName(path: string): string {
  const p = norm(path)
  return p.split('/').pop() || p
}

export function parentOf(path: string): string {
  const p = norm(path)
  const cut = p.lastIndexOf('/')
  if (cut < 0) return p
  return norm(p.slice(0, cut) || '/') || p
}

/** child 가 dir 아래(같은 경로 포함)인가. */
export function isUnder(dir: string, child: string): boolean {
  const d = idOf(dir)
  const c = idOf(child)
  return c === d || c.startsWith(d.endsWith('/') ? d : `${d}/`)
}

/** dir 기준 상대 경로('/' 구분). 밖이면 ''. */
export function relativeTo(dir: string, child: string): string {
  if (!isUnder(dir, child)) return ''
  const d = norm(dir)
  return norm(child).slice(d.endsWith('/') ? d.length : d.length + 1)
}

/** 프로그램에 넘기거나 복사할 경로: 윈도우는 '\' 구분. */
export function nativePath(path: string): string {
  const p = norm(path)
  return isWindowsPath(p) ? p.replace(/\//g, '\\') : p
}

/** 상대 경로·'~' 를 cwd 기준 절대 경로로. */
export function resolvePath(cwd: string, path: string, home = ''): string {
  let p = path.replace(/\\/g, '/')
  if (home && (p === '~' || p.startsWith('~/'))) p = home + p.slice(1)
  const isAbs = p.startsWith('/') || /^[A-Za-z]:\//.test(p)
  const drive = /^[A-Za-z]:/.test(p) ? p.slice(0, 2) : ''
  const parts = isAbs ? [drive] : norm(cwd).replace(/\/$/, '').split('/')
  for (const seg of p.slice(drive.length).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length > 1) parts.pop()
    } else parts.push(seg)
  }
  return norm(parts.join('/') || '/')
}

/** child 를 품은 폴더들(dir 바로 아래부터 child 의 부모까지). */
export function ancestorsWithin(dir: string, child: string): string[] {
  const rel = relativeTo(dir, child)
  if (!rel) return []
  const parts = rel.split('/').slice(0, -1)
  const out: string[] = []
  let cur = norm(dir)
  for (const part of parts) {
    cur = join(cur, part)
    out.push(cur)
  }
  return out
}

/** 터미널에서 글자가 차지하는 칸 수: 한글·한자·전각·이모지는 2칸. */
export function cells(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if ((code >= 0x300 && code <= 0x36f) || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) continue
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      code >= 0x20000
    width += isWide ? 2 : 1
  }
  return width
}

/** 칸 수 width 에 맞게 자르거나(끝에 …) 오른쪽을 빈칸으로 채운다. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  const used = cells(text)
  if (used <= width) return text + ' '.repeat(width - used)
  let out = ''
  let w = 0
  for (const char of text) {
    const cw = cells(char)
    if (w + cw > width - 1) break
    out += char
    w += cw
  }
  return `${out}…${' '.repeat(Math.max(0, width - 1 - w))}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes / 1024
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}초 전`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}분 전`
  return `${Math.round(m / 60)}시간 전`
}

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'psd', 'avif', 'heic',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp',
  'zip', '7z', 'rar', 'gz', 'tar', 'bz2', 'xz',
  'exe', 'dll', 'so', 'dylib', 'bin', 'pyc', 'class', 'o', 'obj', 'lib',
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'mp4', 'mov', 'mkv', 'avi', 'webm',
  'stl', '3mf', 'step', 'stp', 'glb', 'blend', 'gcode', 'ttf', 'otf', 'woff', 'woff2',
  'sqlite', 'db', 'npy', 'pt', 'safetensors', 'onnx', 'ckpt',
])

export function extOf(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isBinaryName(path: string): boolean {
  return BINARY_EXT.has(extOf(path))
}

export function isMarkdownName(path: string): boolean {
  return ['md', 'markdown', 'mdx'].includes(extOf(path))
}
