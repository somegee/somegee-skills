// 다음 할 일 줄과 구분선.
import type { NextView } from '../../types'
import { T } from '../text'
import { C } from './look'
import type { Els } from './look'

/** notes 처럼 테두리와 같은 색의 가로줄. */
export function rule({ Text }: Els, columns: number) {
  return <Text color={C.border}>{'─'.repeat(Math.max(1, columns))}</Text>
}

export function nextRow({ Box, Text, Button }: Els, view: NextView, take: (index: number) => void, dismiss: () => void) {
  if (view.kind === 'hidden') return null
  if (view.kind === 'loading') {
    return (
      <Box key="next">
        <Text dimColor>{T.nextLoading}</Text>
      </Box>
    )
  }
  return (
    <Box key="next" flexWrap="wrap" columnGap={2}>
      <Text color={C.accent}>{T.next}</Text>
      {view.items.map((item, i) => {
        // 클릭으로만 고른다: 숫자 단축키를 두면 빈 입력창에 숫자로 시작하는 글을 칠 때 그 버튼이 눌린다(2026-10-30 결정).
        // 입력창에 넣은 것은 ▶ 와 보라색 굵은 글씨. 다시 누르면 빠진다.
        const isPicked = view.picked === i
        return (
          <Button key={`next-${i}`} onPress={() => take(i)}>
            <Text bold={isPicked} color={isPicked ? C.accent : undefined}>
              {isPicked ? `▶${item.label}` : item.label}
            </Text>
          </Button>
        )
      })}
      <Button key="next-dismiss" plain dimColor label={T.close} onPress={dismiss} />
    </Box>
  )
}
