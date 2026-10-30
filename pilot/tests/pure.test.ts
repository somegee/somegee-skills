// 엔진 없이 도는 계산들.
import { expect, test } from 'claude-code/testing'

import { pickAlert, reasonText } from '../hooks/band/controls'
import { cells } from '../hooks/band/look'
import { contextText, effortText, statusSegments, wrapSegments } from '../hooks/band/status-row'
import { AFTERS, choiceLabel, readConfig } from '../hooks/config'
import { parseVerdict } from '../hooks/effort/judge'
import { cacheSafe, capForSave, clamp, helperFloor, isFollowUp, namedEffort } from '../hooks/effort/levels'
import { handoffMessage, parseHint, safeMemo } from '../hooks/handoff/prompts'
import { hottest, resetTime } from '../hooks/limits'
import { clean, parseSuggestions } from '../hooks/next-steps'
import { cacheTtlOf, minutesLeft } from '../hooks/status/cache'
import { folderOf, kilo, limitLabel, modelLabel } from '../hooks/status/statusline'
import type { StatusData } from '../types'

test('effort 를 범위 안으로 넣고, 절약 모드는 중간을 넘지 않는다', async () => {
  expect(clamp('max', 'low', 'high')).toBe('high')
  expect(clamp('low', 'medium', 'xhigh')).toBe('medium')
  expect(capForSave('xhigh', true)).toBe('medium')
  expect(capForSave('low', true)).toBe('low')
  expect(capForSave('high', false)).toBe('high')
  expect(helperFloor('low', 'high')).toBe('medium')
  expect(helperFloor('low', 'low')).toBe('low')
})

test('effort 를 바꿔도 캐시가 안 깨지는 모델만 자동이 돈다', async () => {
  expect(cacheSafe('claude-opus-5-5')).toBe(true)
  expect(cacheSafe('claude-sonnet-5-5[1m]')).toBe(true)
  expect(cacheSafe('claude-fable-5-1')).toBe(false)
  expect(cacheSafe('claude-opus-4-7')).toBe(false)
})

test('짧은 후속 답과 질문에 직접 적은 effort 를 알아본다', async () => {
  expect(isFollowUp('ㄱㄱ')).toBe(true)
  expect(isFollowUp('응 해줘')).toBe(true)
  expect(isFollowUp('이 파일 전체를 리팩터해줘')).toBe(false)
  expect(namedEffort('effort 높음으로 해줘')).toBe('high')
  expect(namedEffort('에포트 최대로 봐줘')).toBe('max')
  expect(namedEffort('use max effort here')).toBe('max')
  expect(namedEffort("don't use max effort")).toBeUndefined()
  expect(namedEffort('중간 크기 그림')).toBeUndefined()
})

test('판정 답에서 effort 와 이유를 꺼내고, 이상한 답은 버린다', async () => {
  expect(parseVerdict('{"effort":"low","sure":0.8,"why":"짧은 조회"}')).toEqual({ effort: 'low', why: '짧은 조회', sure: 0.8 })
  expect(parseVerdict('답: {"effort":"medium","why":"보통"} 끝')?.effort).toBe('medium')
  expect(parseVerdict('{"effort":"huge"}')).toBeUndefined()
  expect(parseVerdict('그냥 글')).toBeUndefined()
})

test('설정 선택지를 안쪽 값으로 바꾸고, 모르는 값은 기본값', async () => {
  const c = readConfig({ effortFloor: 'medium', effortCeiling: 'max', handoffAfter: '정리 후 계속', compactModel: 'Sonnet', handoffModel: 'Opus' })
  expect([c.floor, c.ceiling]).toEqual(['medium', 'max'])
  expect(c.handoffAfter).toBe('continue')
  expect([c.compactModel, c.handoffModel]).toEqual(['sonnet', 'opus'])
  const d = readConfig({ effortFloor: '없는 값', effortCeiling: 'huge' })
  expect([d.floor, d.ceiling, d.handoffAfter, d.autoEffort, d.compactModel, d.handoffModel]).toEqual(['low', 'high', 'confirm', true, 'session', 'session'])
  expect(choiceLabel(AFTERS, 'copy')).toBe('복사만')
})

test('자동 effort 최저·최고를 따로 고르고, 거꾸로 고르면 맞바꾼다', async () => {
  const one = readConfig({ effortFloor: 'xhigh', effortCeiling: 'xhigh' })
  expect([one.floor, one.ceiling]).toEqual(['xhigh', 'xhigh'])
  const flipped = readConfig({ effortFloor: 'max', effortCeiling: 'medium' })
  expect([flipped.floor, flipped.ceiling]).toEqual(['medium', 'max'])
  expect(clamp('low', flipped.floor, flipped.ceiling)).toBe('medium')
})

test('상태줄 이름들: 모델·한도·폴더·k 단위', async () => {
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelLabel('mystery')).toBe('mystery')
  expect(limitLabel('five_hour')).toBe('5시간')
  expect(limitLabel('seven_day_opus')).toBe('주간(Opus)')
  expect(folderOf('C:\\Users\\me\\projects')).toBe('projects')
  expect(kilo(74_321)).toBe('74k')
  expect(kilo(999)).toBe('999')
})

test('캐시 보관 시간과 남은 분', async () => {
  expect(cacheTtlOf({ cache_creation: { ephemeral_1h_input_tokens: 5 } })).toBe('1h')
  expect(cacheTtlOf({ cache_creation: { ephemeral_5m_input_tokens: 5 } })).toBe('5m')
  expect(cacheTtlOf({ cache_read_input_tokens: 100 })).toBeUndefined()
  expect(minutesLeft(null, 0)).toBeNull()
  expect(minutesLeft(60_000 * 59 + 1, 0)).toBe(60)
  expect(minutesLeft(1000, 5000)).toBe(0)
})

test('한도 80% 넘은 것 중 가장 높은 것, 풀리는 시각', async () => {
  expect(hottest([{ label: '5시간', percent: 42 }])).toBeNull()
  expect(hottest([{ label: '5시간', percent: 85 }, { label: '주간', percent: 91 }])?.label).toBe('주간')
  expect(resetTime({ label: '5시간', percent: 90, resetsAt: '2030-01-01T00:00:00Z' }, 0)).toBe(Date.parse('2030-01-01T00:00:00Z'))
  expect(resetTime(null, 1000)).toBe(1000 + 5 * 60 * 60_000)
})

test('제안 글에서 보이지 않는 문자를 지우고, 없는 명령은 버린다', async () => {
  expect(clean('a\u200bb\x1b[31mc', 10)).toBe('abc')
  expect(clean('tag\u{E0041}', 10)).toBe('')
  const items = parseSuggestions('[{"label":"테스트","prompt":"테스트 돌려줘"},{"label":"x","prompt":"/nope 해줘"}]', new Set(['pilot']))
  expect(items).toEqual([{ label: '테스트', prompt: '테스트 돌려줘' }])
  expect(parseSuggestions('[{"label":"x","prompt":"!rm -rf ."},{"label":"y","prompt":"# 기억해"}]', null)).toEqual([])
  expect(parseSuggestions('[{"label":"x","prompt":"/pilot 상태"}]', null)).toEqual([])
})

test('인계 메모에서 제어 문자열·숨은 문자를 지우고 길이를 묶는다', async () => {
  expect(safeMemo('a\x1b[31mb\u{E0041}c\n- 줄')).toBe('abc\n- 줄')
  expect(safeMemo('x'.repeat(20_000)).length).toBeLessThan(12_100)
})

test('인계 메시지와 인계 추천 판정', async () => {
  expect(handoffMessage('메모', 'confirm', false)).toContain('두 줄로 말한 뒤 내 말을 기다려')
  expect(handoffMessage('메모', 'continue', true)).toContain('HANDOFF.md')
  expect(parseHint('{"handoff":"주제가 바뀜"}')).toBe('주제가 바뀜')
  expect(parseHint('{"handoff":null}')).toBeNull()
  expect(parseHint('몰라')).toBeUndefined()
})

const STATUS: StatusData = {
  folder: 'projects',
  branch: 'main',
  model: 'Opus 5.5',
  modelId: 'claude-opus-5-5',
  version: '2.1.314',
  contextTokens: 74_000,
  contextWindow: 1_000_000,
  contextPercent: 7,
  limits: [{ label: '5시간', percent: 42 }],
}

test('모델 옆 effort 글자: 자동이면 고른 값, 직접이면 앱 값, 캐시 안전하지 않으면 쉼', async () => {
  const base = { isAuto: true, isJudging: false, isSaving: false, appEffort: 'high' }
  expect(effortText({ ...base, pick: { effort: 'low', why: '', by: 'judge' } }, 'claude-opus-5-5').text).toBe('low 자동')
  expect(effortText({ ...base, pick: { effort: 'low', why: '', by: 'judge' } }, 'claude-fable-5-1').text).toBe('high (자동 쉼)')
  expect(effortText({ ...base, isAuto: false, pick: null }, 'claude-opus-5-5').text).toBe('high')
  expect(effortText({ ...base, isJudging: true, pick: null }, 'claude-opus-5-5').text).toBe('판단 중…')
})

test('좁으면 상태줄 조각을 다음 줄로 넘기고, 한글은 두 칸으로 센다', async () => {
  expect(cells('캐시 59분')).toBe(9)
  const view = { pick: null, isAuto: true, isJudging: false, isSaving: false, appEffort: 'high' }
  const all = { withIcons: false, format: 'both', showCache: true, showLimits: true } as const
  const segs = statusSegments(STATUS, view, 59, all)
  expect(segs.map(s => s.key)).toEqual(['place', 'model', 'context', 'cache', 'limits', 'version'])
  expect(wrapSegments(segs, 200)).toHaveLength(1)
  expect(wrapSegments(segs, 40).length).toBeGreaterThan(1)
})

test('경고는 가장 급한 것 하나: 인계 중 > 한도 > 캐시 식음 > 인계 추천 > 판정자 응답 없음', async () => {
  const base = { stage: null, limitGuard: true, isSaving: false, limits: [], cacheMin: 30, contextPercent: 40, hint: null, judgeDown: null }
  expect(pickAlert(base)).toBeNull()
  expect(pickAlert({ ...base, stage: 'writing' })?.kind).toBe('handoff')
  expect(pickAlert({ ...base, limits: [{ label: '5시간', percent: 90 }] })?.kind).toBe('limit')
  expect(pickAlert({ ...base, limits: [{ label: '5시간', percent: 90 }], isSaving: true })).toBeNull()
  expect(pickAlert({ ...base, cacheMin: 0 })?.kind).toBe('cold')
  expect(pickAlert({ ...base, hint: '주제가 바뀜' })?.kind).toBe('hint')
  expect(reasonText({ effort: 'low', why: '짧은 조회', by: 'judge' }, true, 'claude-opus-5-5', null)).toBe('low 근거: 짧은 조회')
})

test('판정 답이 잘리거나 다른 글이 섞여도 effort 를 읽는다', async () => {
  expect(parseVerdict('{"effort":"Low","why":"짧음"}')?.effort).toBe('low')
  expect(parseVerdict('먼저 {생각} 그리고 {"effort":"high","why":"큼"}')?.effort).toBe('high')
  expect(parseVerdict('{"effort":"medium","sure":0.4,"why":"폴더 범위 불명')?.effort).toBe('medium')
  expect(parseVerdict('{"effort":"giant"}')).toBeUndefined()
})

test('컨텍스트 표시: 토큰(기본) · 퍼센트 · 둘 다', async () => {
  expect(contextText(STATUS, 'tokens')).toBe('74k/1000k')
  expect(contextText(STATUS, 'percent')).toBe('7%')
  expect(contextText(STATUS, 'both')).toBe('74k/1000k 7%')
  expect(readConfig({}).contextFormat).toBe('tokens')
  expect(readConfig({ contextFormat: '둘 다' }).contextFormat).toBe('both')
})

test('캐시·한도 표시는 기본으로 숨기고, 켜면 보인다', async () => {
  const view = { pick: null, isAuto: true, isJudging: false, isSaving: false, appEffort: 'high' }
  const c = readConfig({})
  expect([c.showCache, c.showLimits]).toEqual([false, false])
  const hidden = statusSegments(STATUS, view, 59, { withIcons: false, format: c.contextFormat, showCache: c.showCache, showLimits: c.showLimits })
  expect(hidden.map(s => s.key)).toEqual(['place', 'model', 'context', 'version'])
  const shown = statusSegments(STATUS, view, 59, { withIcons: false, format: 'tokens', showCache: true, showLimits: true })
  expect(shown.map(s => s.key)).toContain('cache')
  expect(shown.map(s => s.key)).toContain('limits')
})
