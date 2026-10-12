export type NoteItem = { text: string; isDone: boolean }

export type NoteTab = {
  title: string
  goal?: string
  doneWhen?: string
  items: NoteItem[]
  memo?: string
  updatedAt: string
}

// 되돌리기 한 건: 바뀐 탭마다 바뀌기 전 모습(before)과 바뀐 뒤 이름(afterTitle).
// before 만 있으면 지워진 탭, afterTitle 만 있으면 새로 생긴 탭이다.
export type NoteChangePart = { index: number; before?: NoteTab; afterTitle?: string }
export type NoteChange = { label: string; at: string; parts: NoteChangePart[] }

// history = 되돌릴 변경, future = 되돌린 뒤 다시 할 변경(앞으로가기). 예전 파일엔 future 가 없을 수 있다.
export type NotesBook = { root: string; tabs: NoteTab[]; history: NoteChange[]; future?: NoteChange[]; active?: string }

declare module 'claude-code' {
  interface PluginState {
    notes: { book: NotesBook; scroll: number }
  }
}
