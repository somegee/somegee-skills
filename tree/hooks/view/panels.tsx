// 머리줄·보기 탭·검색칸·미리보기·크기 그림·최근 작업·git 진행 줄.
import type { GitInfo, GitOp, MapData, Mode, Preview, Recent } from '../../types'
import { ago, baseName, cells, fit, formatSize, idOf, parentOf, relativeTo } from '../paths'
import { OTHERS_COLOR, TILE_COLORS, colorHex, layout, paint, topTiles } from '../treemap'
import { C } from './look'
import type { Acts, Els } from './look'

function innerCount(git: GitInfo | null): number {
  if (!git) return 0
  return Object.keys(git.repos).filter(id => id !== idOf(git.top)).length
}

/** 맨 위: 폴더 이름 · 브랜치 ↑↓ · 추적 중인 안쪽 저장소 수. (바뀐 파일 수는 탭에 있다) */
export function header(els: Els, root: string, git: GitInfo | null) {
  const { Box, Text } = els
  return (
    <Box key="head" flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text bold color={C.accent}>
        {baseName(root)}
      </Text>
      {git?.top ? (
        <Text color={C.commit}>
          ⎇ {git.branch || '?'}
          {git.ahead ? <Text color={C.commit}> ↑{git.ahead}</Text> : null}
          {git.behind ? <Text color={C.modified}> ↓{git.behind}</Text> : null}
        </Text>
      ) : (
        <Text dimColor>git 아님</Text>
      )}
      {innerCount(git) > 0 ? <Text dimColor>{`안쪽 저장소 ${innerCount(git)}개`}</Text> : null}
    </Box>
  )
}

/** 보기 탭: 고른 탭은 강조색 바탕(뒤집기), 나머지는 흐리게. 새로 고침은 오른쪽 끝. */
export function tabs(els: Els, mode: Mode, changed: number, acts: Acts) {
  const { Box, Text, Button } = els
  const items: { mode: Mode; label: string }[] = [
    { mode: 'tree', label: '트리' },
    { mode: 'changes', label: changed > 0 ? `변경 ${changed}` : '변경' },
    { mode: 'map', label: '크기' },
  ]
  return (
    <Box key="tabs" flexDirection="row" justifyContent="space-between">
      <Box flexDirection="row" columnGap={1}>
        {items.map(item => {
          const isOn = item.mode === mode
          return (
            <Button key={`tab:${item.mode}`} plain onPress={() => acts.mode(item.mode)}>
              <Text color={isOn ? C.accent : item.mode === 'changes' && changed > 0 ? C.modified : undefined} inverse={isOn} bold={isOn} dimColor={!isOn && !(item.mode === 'changes' && changed > 0)}>
                {` ${item.label} `}
              </Text>
            </Button>
          )
        })}
      </Box>
      <Button key="refresh" plain dimColor onPress={() => acts.refresh()}>
        ↻ 새로 고침
      </Button>
    </Box>
  )
}

/** 검색칸: 둥근 테두리로 감싸 입력하는 곳임을 바로 알게 한다. */
export function searchBox(els: Els, query: string, count: number | null, acts: Acts) {
  const { Box, Text, Input, Button } = els
  return (
    <Box key="search" flexDirection="row" columnGap={1} borderStyle="round" borderDimColor paddingX={1}>
      <Text dimColor>⌕</Text>
      <Box flexGrow={1}>
        <Input key="q" placeholder="파일 이름 검색 · Enter" value={query} onSubmit={value => acts.search(value)} />
      </Box>
      {count !== null ? <Text dimColor>{count}개</Text> : null}
      {query ? (
        <Button key="clear" plain onPress={() => acts.clearSearch()}>
          ×
        </Button>
      ) : null}
    </Box>
  )
}

/** 구역을 나누는 흐린 가로줄. label 이 있으면 '─ 이름 ────' 모양. */
export function rule(els: Els, width: number, label = '') {
  const { Text } = els
  const head = label ? `─ ${label} ` : ''
  return (
    <Text dimColor>
      {head}
      {'─'.repeat(Math.max(0, width - cells(head)))}
    </Text>
  )
}

/** 미리보기 칸: 돌아가기 · 이름 · 열기 · 경로 복사, 그 아래 내용. */
export function previewPanel(els: Els, preview: Preview, root: string, width: number, acts: Acts) {
  const { Box, Text, Button, Code, Markdown } = els
  const rel = relativeTo(root, preview.path) || preview.path
  return (
    <Box key="preview" flexDirection="column">
      <Box key="pv-head" flexDirection="row" columnGap={2} flexWrap="wrap">
        <Button key="back" plain onPress={() => acts.closePreview()}>
          <Text color={C.accent} bold>
            ← 돌아가기
          </Text>
        </Button>
        <Button key="pv-open" plain onPress={() => acts.open(preview.path)}>
          <Text bold>열기</Text>
        </Button>
        <Button key="pv-copy" plain onPress={e => acts.copy(preview.path, e.surface)}>
          <Text bold>경로 복사</Text>
        </Button>
      </Box>
      <Text bold color={preview.kind === 'diff' ? C.modified : undefined}>
        {fit(`${preview.kind === 'diff' ? '바뀐 내용 · ' : ''}${rel}`, width)}
      </Text>
      {preview.note ? <Text dimColor>{preview.note}</Text> : null}
      {preview.kind === 'code' ? <Code source={preview.text || ' '} path={preview.path} startLine={1} wrap="truncate-end" /> : null}
      {preview.kind === 'markdown' ? <Markdown text={preview.text || ' '} /> : null}
      {preview.kind === 'diff'
        ? preview.files.map((f, i) => (
            <Box key={`df-${i}`} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
              <Text>
                <Text bold>{fit(f.title, Math.max(4, width - 14))}</Text>
                <Text color={C.added}> +{f.add}</Text>
                <Text color={C.deleted}> -{f.del}</Text>
              </Text>
              {f.source.startsWith('@@') ? <Code source={f.source} path={f.title} format="diff" wrap="truncate-end" /> : <Text dimColor>{f.source}</Text>}
            </Box>
          ))
        : null}
    </Box>
  )
}

const MAP_ROWS = 12
const MAP_KEEP = 14

/** 크기 그림: 위로 · 폴더 이름 · 칸 그림(터미널) · 항목 목록(누르면 폴더는 들어가고 파일은 고름). */
export function mapPanel(els: Els, map: MapData | null, root: string, width: number, acts: Acts) {
  const { Box, Text, Button, Raster } = els
  if (!map) return <Text dimColor>폴더를 고르고 [크기 그림]을 누르세요.</Text>
  const rel = relativeTo(root, map.dir)
  const canUp = idOf(map.dir) !== idOf(root) && rel !== ''
  const { shown, othersSize, othersCount } = topTiles(map.tiles, MAP_KEEP)
  const sizes = [...shown.map(t => t.size), othersSize]
  const colors = [...shown.map((_, i) => TILE_COLORS[i % TILE_COLORS.length] ?? OTHERS_COLOR), OTHERS_COLOR]
  const labels = [...shown.map(t => t.name), `+${othersCount}`]
  const columns = Math.max(10, Math.min(512, width))
  const cellsB64 = map.tiles.length > 0 ? paint(layout(sizes, columns, MAP_ROWS), colors, labels, columns, MAP_ROWS) : ''
  const pct = (n: number) => (map.total > 0 ? `${Math.round((n / map.total) * 100)}%` : '')
  return (
    <Box key="map" flexDirection="column">
      <Box key="map-head" flexDirection="row" columnGap={2}>
        {canUp ? (
          <Button key="map-up" plain onPress={() => acts.map(parentOf(map.dir))}>
            <Text color={C.accent} bold>
              ↑ 위로
            </Text>
          </Button>
        ) : null}
        <Text bold>{fit(`${rel || baseName(root)}/  ${formatSize(map.total)}`, Math.max(8, width - 10))}</Text>
      </Box>
      {map.isLoading ? <Text dimColor>크기를 재는 중…</Text> : null}
      {map.isPartial ? <Text dimColor>파일이 많아 일부만 셌습니다.</Text> : null}
      {cellsB64 ? <Raster key="map-raster" columns={columns} rows={MAP_ROWS} cells={cellsB64} /> : null}
      {shown.map((t, i) => (
        <Button key={`tile:${idOf(t.path)}`} plain onPress={() => (t.isDir ? acts.map(t.path) : acts.jump(t.path))}>
          <Text color={colorHex(TILE_COLORS[i % TILE_COLORS.length] ?? OTHERS_COLOR)}>■ </Text>
          <Text dimColor={!t.isDir}>{fit(t.name + (t.isDir ? '/' : ''), Math.max(4, width - 16))}</Text>
          <Text> {formatSize(t.size).padStart(8)}</Text>
          <Text dimColor> {pct(t.size).padStart(4)}</Text>
        </Button>
      ))}
      {othersCount > 0 ? (
        <Text dimColor>
          <Text color={colorHex(OTHERS_COLOR)}>■ </Text>그 밖 {othersCount}개 {formatSize(othersSize)} {pct(othersSize)}
        </Text>
      ) : null}
    </Box>
  )
}

/** 최근 작업: Claude 가 만든(+)·고친(~) 파일. 누르면 트리에서 그 자리로. */
export function recentPanel(els: Els, recent: readonly Recent[], root: string, width: number, acts: Acts) {
  const { Box, Text, Button } = els
  if (recent.length === 0) return null
  return (
    <Box key="recent" flexDirection="column" marginTop={1}>
      <Box key="recent-head" flexDirection="row" justifyContent="space-between">
        {rule(els, Math.max(0, width - 8), '최근 작업')}
        <Button key="forget" plain dimColor onPress={() => acts.forget()}>
          비우기
        </Button>
      </Box>
      {recent.map(r => {
        const folder = relativeTo(root, parentOf(r.path))
        const name = baseName(r.path)
        return (
          <Button key={`recent:${idOf(r.path)}`} plain onPress={() => acts.jump(r.path)}>
            <Text color={r.kind === 'new' ? C.added : C.modified}>{r.kind === 'new' ? '+ ' : '~ '}</Text>
            <Text>{name}</Text>
            <Text dimColor>{fit(folder ? `  ${folder}` : '', Math.max(0, width - 4 - name.length))}</Text>
          </Button>
        )
      })}
    </Box>
  )
}

const OP_SHOW_MS = 30_000

/** 맨 아래: Claude 가 돌린 git 명령의 진행 상태(끝난 뒤 30초까지). */
export function gitOpLine(els: Els, op: GitOp | null, now: number) {
  const { Text } = els
  if (!op || (op.state !== 'running' && now - op.at > OP_SHOW_MS)) return null
  const color = op.state === 'failed' ? C.failed : op.state === 'running' ? C.write : C.commit
  return (
    <Text color={color}>
      {op.state === 'running' ? '◌ ' : op.state === 'done' ? '● ' : '✕ '}
      {op.label}
      {op.state === 'running' ? '' : ` · ${ago(now - op.at)}`}
    </Text>
  )
}
