// 터미널 옆 창의 색 묶음. /config 의 notes.theme 로 고르고, notes.background 로 창 배경색만 따로 덮어쓴다.
// 기본 = Claude Code 테마(/theme)의 색 이름을 써서 본체 화면과 같은 색을 따라간다. 배경·글자는 터미널 것 그대로.
// 다른 테마는 배경을 칠하므로 글자색도 함께 정한다.
export const THEME_NAMES = ['기본', '어둡게', '밝게', '고대비'] as const
export type ThemeName = (typeof THEME_NAMES)[number]

export type NotesTheme = {
  // 창 배경, 글자색. 비어 있으면 터미널 것을 그대로 쓴다.
  bg?: string
  text?: string
  // 지금 하는 단계(안 끝난 첫 단계) 줄.
  current: { bg: string; text: string }
  // 탭 줄 둘레 테두리. 지금 탭 앞 ▶ 는 arrow, 없으면 이 색.
  tabBorder: string
  arrow?: string
  // 버튼 줄 밑 가로줄. 없으면 흐린 글자색.
  rule?: string
  pagerBg: string
  section: { goal: string; doneWhen: string; todo: string; results: string; memo: string }
  mark: { blocked: string; ask: string; waiting: string; working: string }
}

// 테두리·가로줄은 본체 입력창 테두리(promptBorder)와 같은 색이라 본체가 그리는 창 틀과 어울린다.
const BASE: NotesTheme = {
  current: { bg: 'diffAdded', text: 'text' },
  tabBorder: 'promptBorder',
  arrow: 'suggestion',
  rule: 'promptBorder',
  pagerBg: 'subtle',
  section: { goal: 'planMode', doneWhen: 'warning', todo: 'success', results: 'ide', memo: 'remember' },
  mark: { blocked: 'error', ask: 'permission', waiting: 'warning', working: 'success' },
}

const THEMES: Record<ThemeName, NotesTheme> = {
  기본: BASE,
  어둡게: {
    bg: '#1e2230',
    text: '#e6e9ef',
    current: { bg: '#2e6b3f', text: '#ffffff' },
    tabBorder: '#7aa2f7',
    pagerBg: '#3b4261',
    section: { goal: '#7dcfff', doneWhen: '#e0af68', todo: '#9ece6a', results: '#7aa2f7', memo: '#bb9af7' },
    mark: { blocked: '#f7768e', ask: '#7dcfff', waiting: '#e0af68', working: '#9ece6a' },
  },
  밝게: {
    bg: '#fafafa',
    text: '#1f2328',
    current: { bg: '#d6f0dc', text: '#14532d' },
    tabBorder: '#0969da',
    pagerBg: '#d0d7de',
    section: { goal: '#0969da', doneWhen: '#9a6700', todo: '#1a7f37', results: '#0550ae', memo: '#8250df' },
    mark: { blocked: '#cf222e', ask: '#0969da', waiting: '#9a6700', working: '#1a7f37' },
  },
  고대비: {
    bg: '#000000',
    text: '#ffffff',
    current: { bg: '#ffff00', text: '#000000' },
    tabBorder: '#00ffff',
    pagerBg: '#444444',
    section: { goal: '#00ffff', doneWhen: '#ffff00', todo: '#00ff00', results: '#5c9dff', memo: '#ff66ff' },
    mark: { blocked: '#ff3333', ask: '#00ffff', waiting: '#ffff00', working: '#00ff00' },
  },
}

export const BASE_THEME = BASE

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// 설정값 → 색 묶음. 모르는 테마 이름은 기본, 배경색은 #RGB·#RRGGBB 일 때만 덮어쓴다.
export function toTheme(name: unknown, background: unknown): NotesTheme {
  const theme = THEMES[THEME_NAMES.includes(name as ThemeName) ? (name as ThemeName) : '기본']
  const bg = typeof background === 'string' ? background.trim() : ''
  return HEX.test(bg) ? { ...theme, bg } : theme
}
