// 사람이 보는 글은 여기 한곳에 모은다.
import type { Effort } from '../types'

// effort 단계는 Claude Code 표기 그대로 영어로 보인다(2026-10-30 결정).
export const EFFORT_LABEL: Readonly<Record<Effort, string>> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
}

/** 실패 사유 → 짧은 한국어. */
export function failWhy(reason: string): string {
  if (reason === 'unreadable') return '답을 못 읽음'
  if (reason === 'aborted') return '시간 초과'
  if (reason === 'empty-reply') return '빈 답'
  if (reason.startsWith('api-error')) return `API 오류${reason.slice('api-error'.length)}`
  return reason
}

export const T = {
  judging: '판단 중…',
  auto: '자동',
  autoPaused: '자동 쉼',
  autoOn: '자동 켜짐',
  autoOff: '자동 꺼짐',
  saveOn: '절약 중',
  handoff: '인계',
  close: '닫기',
  next: '다음',
  nextLoading: '다음 할 일 고르는 중…',
  cacheCold: '캐시 만료',
  cache: (min: number) => `캐시 ${min}분`,
  manualTook: (level: string) => `직접 고른 ${level}(으)로 갑니다. 자동은 꺼졌어요 — [자동 켜짐]을 누르면 다시 맡깁니다.`,
  pausedWhy: '이 모델은 effort 를 바꾸면 캐시가 깨져서 자동이 쉽니다',
  judgeDown: (why: string) => `Haiku 판정 실패(${failWhy(why)}) — 이번엔 앱 설정대로 보냅니다.`,
  coldAlert: '캐시가 만료됐어요. 다음 질문은 대화 전체를 처음부터 다시 읽어서 느리고 한도를 더 씁니다.',
  limitAlert: (label: string, percent: number) => `${label} 한도 ${percent}%`,
  limitSaveHint: '절약을 켜면 한도가 풀릴 때까지 effort 를 medium 이하로 묶어요',
  saving: (until: string) => `절약 모드: effort 를 medium 이하로 (${until}까지)`,
  hintAlert: (why: string) => `새 대화로 넘기면 좋겠어요: ${why}`,
  handoffWriting: '인계 메모 쓰는 중…',
  handoffClearing: '대화를 비우고 메모를 넣는 중…',
  handoffQuick: '빠르게',
  handoffFull: '꼼꼼히',
  // 받침 있는 이름(Sonnet·모델)은 '이', 없는 이름(Haiku·Opus)은 '가'.
  handoffQuickNote: (model: string) => `${model}${/(Sonnet|모델)$/.test(model) ? '이' : '가'} 지금까지의 대화를 메모로 정리합니다`,
  handoffAbout: '지금까지 한 일을 메모 한 장으로 정리하고, 그 메모로 새 대화를 처음부터 시작합니다. 대화가 길어져 느려지거나 주제가 바뀔 때 씁니다.',
  handoffSessionModel: '지금 대화 중인 모델',
  handoffFullNote: 'git 상태까지 확인하고 HANDOFF.md 를 새로 씁니다 (기존 내용은 덮어씀)',
  handoffAfterNote: {
    confirm: '지금 설정: 지금 대화를 비우고 새 대화에 메모를 넣은 뒤, 내 입력을 기다립니다',
    continue: '지금 설정: 지금 대화를 비우고 새 대화에 메모를 넣은 뒤, 바로 이어서 진행합니다',
    copy: '지금 설정: 메모를 복사만 합니다. 새 대화에 직접 붙여 넣어 시작하세요 (지금 대화는 그대로)',
  } as const,
  handoffCopied: '인계 메모를 복사했어요. 새 대화에 붙여 넣으세요.',
  handoffInBox: '복사가 안 돼서 인계 메모를 입력창에 넣었어요.',
  handoffFailed: (why: string) => `인계 실패: ${why}`,
  handoffWait: '답이 끝난 뒤에 인계할 수 있어요.',
  handoffDropped: '새 대화에 메모를 못 보내서 입력창에 넣었어요. 확인하고 보내 주세요.',
  handoffTimeout: '인계 메모가 너무 오래 안 써져서 그만뒀어요. 대화는 그대로예요.',
  handoffBusy: '진행 중인 턴이 있어 대화를 비우지 않고 인계 메모를 입력창에 넣었어요.',
  handoffNotWritten: '인계 메모가 안 써져서 대화는 그대로 뒀어요.',
  compactFailed: (model: string, why: string) => `${model} 압축 실패(${why}) — 원래 방식으로 압축합니다.`,
  handoffModelFailed: (model: string) => `${model} 가 인계 메모를 못 써서 대화 모델로 씁니다.`,
  on: '켬',
  off: '끔',
}
