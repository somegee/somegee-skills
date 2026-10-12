// status: 막힘(blocked)·대기(waiting) 표시, note 는 그 사유. 풀리면 status 를 비우고 resolved 에 처리 내역을 남긴다.
export type NoteItemStatus = 'blocked' | 'waiting'
export type NoteItem = { text: string; isDone: boolean; status?: NoteItemStatus; note?: string; resolved?: string }

// 이 탭을 마지막으로 다룬 세션. title 은 /rename 이름(없으면 자동 제목), 둘 다 없으면 비어 있다.
export type NoteSession = { id: string; title?: string }

export type NoteTab = {
  title: string
  goal?: string
  doneWhen?: string
  items: NoteItem[]
  results?: string[]
  memo?: string
  session?: NoteSession
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
    // tick: 지금 하는 단계의 배경이 서서히 바뀌고 갱신 시각이 흐르도록 일정 간격으로 오르는 수.
    notes: { book: NotesBook; scroll: number; tick: number }
  }
}
