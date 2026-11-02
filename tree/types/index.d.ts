// tree 의 $.state 계약. 창이 그릴 때 읽는 값만 여기 둔다(모듈 변수는 다시 불러오면 사라진다).
// 경로는 모두 '/' 로 맞춘 절대 경로다. 비교용 열쇠(id)는 윈도우에서 소문자로 바꾼 같은 경로다.

/** 폴더 한 칸의 항목. */
export type Entry = { name: string; isDir: boolean; size: number }

/** 창에서 고를 수 있는 보기. */
export type Mode = 'tree' | 'changes' | 'map'

/** Claude 가 파일에 한 일: 읽기(보라)·쓰기(주황)·커밋(초록). */
export type TouchKind = 'read' | 'write' | 'commit'
export type Touch = { kind: TouchKind; at: number }

/** git 상태. files·lines 의 열쇠는 id(비교용 경로). */
export type GitInfo = {
  top: string
  branch: string
  upstream: string
  ahead: number
  behind: number
  /** id → 한 글자 상태(M·A·D·R·?) */
  files: Record<string, string>
  /** id → [더한 줄, 지운 줄] */
  lines: Record<string, readonly [number, number]>
  /** id → 보여 줄 절대 경로 */
  paths: Record<string, string>
}

/** Claude 가 돌린 git 명령(커밋·푸시 등)의 진행 상태: 창 맨 아래 한 줄. */
export type GitOp = { label: string; state: 'running' | 'done' | 'failed'; at: number }

/** Claude 가 만들고(new) 고친(edit) 파일: '최근 작업' 목록과 이름 옆 +·~ 표시. */
export type Recent = { path: string; kind: 'new' | 'edit'; at: number }

/** 미리보기 칸에 띄운 것. */
export type Preview =
  | { kind: 'code'; path: string; text: string; note: string }
  | { kind: 'markdown'; path: string; text: string; note: string }
  | { kind: 'diff'; path: string; files: readonly DiffFile[]; note: string }
  | { kind: 'note'; path: string; note: string }

export type DiffFile = { title: string; source: string; add: number; del: number }

/** 폴더 크기 그림의 한 칸. */
export type Tile = { path: string; name: string; size: number; isDir: boolean }
export type MapData = { dir: string; total: number; tiles: readonly Tile[]; isPartial: boolean; isLoading: boolean }

declare module 'claude-code' {
  interface PluginState {
    tree: {
      root: string
      mode: Mode
      opened: readonly string[]
      listings: Record<string, readonly Entry[]>
      selected: string | null
      query: string
      results: readonly string[] | null
      git: GitInfo | null
      touches: Record<string, Touch>
      gitOp: GitOp | null
      recent: readonly Recent[]
      preview: Preview | null
      map: MapData | null
      tick: number
    }
  }
}
