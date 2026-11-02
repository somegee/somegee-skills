// 폴더 크기 그림: 칸을 크기 비율로 나누고(이분할 방식) 터미널 Raster 칸으로 칠한다. 순수 함수.
import type { Tile } from '../types'

export type Rect = { index: number; x: number; y: number; w: number; h: number }

/** 같은 색이 이웃하지 않도록 서로 다른 색 10개. */
export const TILE_COLORS = [0x5c9cf5, 0xf59e42, 0x4fb477, 0xa78bfa, 0xf472b6, 0x2ec4d6, 0xe5c07b, 0xe06c75, 0x98c379, 0xc678dd]
export const OTHERS_COLOR = 0x6b7280

export function colorHex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

/** 크기 비율대로 사각형을 나눈다. 셀은 세로가 가로의 약 2배라 가로 폭을 반으로 쳐서 긴 쪽을 고른다. */
export function layout(sizes: readonly number[], w: number, h: number): Rect[] {
  const out: Rect[] = []
  const items = sizes.map((size, index) => ({ size, index })).filter(i => i.size > 0)
  split(items, 0, 0, w, h, out)
  return out
}

function split(items: readonly { size: number; index: number }[], x: number, y: number, w: number, h: number, out: Rect[]): void {
  if (items.length === 0 || w <= 0 || h <= 0) return
  if (items.length === 1) {
    out.push({ index: items[0]?.index ?? 0, x, y, w, h })
    return
  }
  const total = items.reduce((s, i) => s + i.size, 0)
  let acc = 0
  let k = 0
  while (k < items.length - 1 && acc + (items[k]?.size ?? 0) <= total / 2) acc += items[k++]?.size ?? 0
  if (k === 0) acc = items[k++]?.size ?? 0
  const a = items.slice(0, k)
  const b = items.slice(k)
  const ratio = acc / total
  if (w / 2 >= h) {
    const wa = w * ratio
    split(a, x, y, wa, h, out)
    split(b, x + wa, y, w - wa, h, out)
  } else {
    const ha = h * ratio
    split(a, x, y, w, ha, out)
    split(b, x, y + ha, w, h - ha, out)
  }
}

/** 큰 것 몇 개만 칸으로 두고 나머지는 '그 밖'으로 묶는다. */
export function topTiles(tiles: readonly Tile[], keep: number): { shown: Tile[]; othersSize: number; othersCount: number } {
  const shown = tiles.slice(0, keep)
  const rest = tiles.slice(keep)
  return { shown, othersSize: rest.reduce((s, t) => s + t.size, 0), othersCount: rest.length }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64.charAt((n >> 18) & 63) + BASE64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? BASE64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? BASE64.charAt(n & 63) : '='
  }
  return out
}

/** 이름을 칸에 쓸 수 있는 글자(폭 1칸 ASCII)로. 한글 등은 '·'. */
function asciiLabel(name: string): string {
  return [...name].map(ch => (/^[\x20-\x7e]$/.test(ch) ? ch : '·')).join('')
}

const DARK_TEXT = 0x111111
const DEFAULT_COLOR = 0x01000000

/** Raster 의 cells(base64). labels[i] 는 rects 의 index 번째 칸 이름. */
export function paint(rects: readonly Rect[], colors: readonly number[], labels: readonly string[], columns: number, rows: number): string {
  const words = new Uint32Array(columns * rows * 3)
  const owner = new Int32Array(columns * rows).fill(-1)
  rects.forEach((r, ri) => {
    const x0 = Math.round(r.x)
    const x1 = Math.round(r.x + r.w)
    const y0 = Math.round(r.y)
    const y1 = Math.round(r.y + r.h)
    for (let y = y0; y < y1 && y < rows; y++) for (let x = x0; x < x1 && x < columns; x++) owner[y * columns + x] = ri
  })
  for (let i = 0; i < columns * rows; i++) {
    const ri = owner[i] ?? -1
    const color = ri >= 0 ? (colors[rects[ri]?.index ?? 0] ?? OTHERS_COLOR) : DEFAULT_COLOR
    words[i * 3] = 0x20
    words[i * 3 + 1] = DARK_TEXT
    words[i * 3 + 2] = color
  }
  // 칸마다 왼쪽 위에 이름을 쓴다(들어가는 만큼만)
  rects.forEach(r => {
    const x0 = Math.round(r.x)
    const y0 = Math.round(r.y)
    const width = Math.round(r.x + r.w) - x0
    if (width < 3 || Math.round(r.y + r.h) - y0 < 1 || y0 >= rows) return
    const text = asciiLabel(labels[r.index] ?? '').slice(0, width - 1)
    for (let j = 0; j < text.length && x0 + j < columns; j++) words[(y0 * columns + x0 + j) * 3] = text.charCodeAt(j)
  })
  return toBase64(new Uint8Array(words.buffer))
}
