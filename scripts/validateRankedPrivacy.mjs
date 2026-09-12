import assert from 'node:assert/strict'
import { maskRankedTrainerName, maskRankedTrainerText, maskRankedMatch } from '../src/data/rankedPrivacy.js'
import { createRankedBattle, getRankedBattleView, getRankedTimelineView } from '../server/rankedBattle.js'
import { normalizePokemon } from '../src/data/trainingData.js'

let passed = 0
const test = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

test('trainer masking preserves one normalized grapheme and exactly two stars', () => {
  for (const [input, expected] of [
    ['신동수', '신**'], ['Alex', 'A**'], ['김', '김**'], ['  Alex  ', 'A**'], ['\u1109\u1175\u11ab동수', '신**'],
    ['E\u0301mile', 'É**'], ['👩🏽‍🔬박사', '👩🏽‍🔬**'], ['🇰🇷트레이너', '🇰🇷**'], ['\u202e\nAlex\u2069', 'A**'],
    ['\u200b\u200dAlex', 'A**'], ['', '트**'], ['   ', '트**'], [null, '트**'], [undefined, '트**'],
  ]) {
    assert.equal(maskRankedTrainerName(input), expected)
    assert.equal(maskRankedTrainerName(expected), expected, 'Server and client masking must be idempotent')
  }
})

const messages = [
  ['피카츄 vs 신동수, 레이팅 배틀 시작!', '피** vs 신**, 레이팅 배틀 시작!'],
  ['피카츄은(는) 피카츄, 잠만보을(를) 내보냈다!', '피**은(는) 피카츄, 잠만보을(를) 내보냈다!'],
  ['피카츄은(는) 피카츄을(를) 불러들였다!', '피**은(는) 피카츄을(를) 불러들였다!'],
  ['피카츄 진영에 리플렉터의 효과가 펼쳐졌다!', '피** 진영에 리플렉터의 효과가 펼쳐졌다!'],
  ['피카츄 진영에 바다의불꽃가 펼쳐졌다!', '피** 진영에 바다의불꽃가 펼쳐졌다!'],
  ['피카츄 진영이 와이드가드을(를) 막아냈다!', '피** 진영이 와이드가드을(를) 막아냈다!'],
  ['피카츄 진영의 빛의장막 효과가 사라졌다.', '피** 진영의 빛의장막 효과가 사라졌다.'],
  ['피카츄 팀의 상태 이상이 회복되었다!', '피** 팀의 상태 이상이 회복되었다!'],
  ['피카츄의 그 위치에는 이미 미래의 공격이 예정되어 있다!', '피**의 그 위치에는 이미 미래의 공격이 예정되어 있다!'],
  ['피카츄의 피카츄이(가) 전기타입으로 테라스탈했다!', '피**의 피카츄이(가) 전기타입으로 테라스탈했다!'],
  ['피카츄의 피카츄이(가) 다이맥스했다!', '피**의 피카츄이(가) 다이맥스했다!'],
  ['피카츄의 피카츄이(가) 거다이맥스했다!', '피**의 피카츄이(가) 거다이맥스했다!'],
  ['피카츄의 메가리자몽X! 메가진화 성공!', '피**의 메가리자몽X! 메가진화 성공!'],
  ['피카츄의 원시그란돈! 원시회귀 성공!', '피**의 원시그란돈! 원시회귀 성공!'],
  ['피카츄와 피카츄의 전력! Z파워가 기술에 모인다!', '피**와 피카츄의 전력! Z파워가 기술에 모인다!'],
  ['피카츄: 되살릴 포켓몬을 선택하고 있습니다.', '피**: 되살릴 포켓몬을 선택하고 있습니다.'],
  ['피카츄: 다음 포켓몬을 선택하고 있습니다.', '피**: 다음 포켓몬을 선택하고 있습니다.'],
  ['피카츄의 승리!', '피**의 승리!'],
]
test('every legacy trainer sentence masks only its structural trainer position', () => {
  for (const [original, expected] of messages) assert.equal(maskRankedTrainerText(original, ['피카츄', '신동수']), expected)
})

test('Pokemon, move and item text matching a trainer nickname remains readable', () => {
  for (const message of ['피카츄의 10만볼트!', '피카츄은(는) 쓰러졌다!', '피카츄은(는) 마비 상태가 되었다!',
    '피카츄의 테라스탈이(가) 발동했다!', '피카츄은(는) 리샘열매을(를) 먹었다!', '피카츄, 돌아와!',
    '피카츄 진영이 정전기 특성을 베껴 그렸다!', '피카츄 진영의 위치가 뒤바뀌었다!',
    '피카츄 진영의 특성이 선제 기술을 막아냈다!', '피카츄 진영의 장벽이 깨졌다!', '피카츄 진영의 함정이 제거되었다!']) {
    assert.equal(maskRankedTrainerText(message, ['피카츄']), message)
  }
})

test('legacy whitespace, bidi controls, punctuation and vs inside nicknames cannot defeat masking', () => {
  for (const name of ['  Alex  ', '\u202eAlex\u2069', '[Alex].*', 'Alex vs Bob', '신의 힘']) {
    const message = `${name}은(는) 피카츄을(를) 내보냈다!`
    assert.equal(maskRankedTrainerText(message, [name]), `${maskRankedTrainerName(name)}은(는) 피카츄을(를) 내보냈다!`)
    assert.equal(maskRankedTrainerText(`신동수 vs ${name}, 레이팅 배틀 시작!`, ['신동수', name]), `신** vs ${maskRankedTrainerName(name)}, 레이팅 배틀 시작!`)
  }
})

test('masking a cached match covers both names, state, log IDs and timeline without mutating UID or Pokemon fields', () => {
  const match = { id: 'Alexander', you: { name: 'Alexander', uid: 'Alexander' }, opponent: { name: 'Amelia', uid: 'Amelia' },
    state: { player: { name: 'Alexander', team: [{ name: 'Alexander', battleId: 'Amelia' }] }, opponent: { name: 'Amelia', team: [{ name: '피카츄' }] }, opponentMeta: { name: 'Amelia' },
      log: [{ id: '4-80-Alexander의 승리!', message: 'Alexander의 승리!' }, { id: '4-80-Amelia의 승리!', message: 'Amelia의 승리!' }] },
    timeline: [{ id: '4-0-gimmick', message: 'Amelia의 피카츄이(가) 전기타입으로 테라스탈했다!', actorName: 'Amelia', targetName: 'Alexander', moveName: 'Alexander', itemName: 'Amelia', state: null }] }
  match.timeline[0].state = structuredClone(match.state)
  const before = structuredClone(match), masked = maskRankedMatch(match)
  assert.deepEqual(match, before)
  assert.equal(masked.you.name, 'A**'); assert.equal(masked.opponent.name, 'A**')
  assert.equal(masked.state.player.name, 'A**'); assert.equal(masked.state.opponentMeta.name, 'A**')
  assert.equal(masked.id, 'Alexander'); assert.equal(masked.you.uid, 'Alexander'); assert.equal(masked.opponent.uid, 'Amelia')
  assert.deepEqual(masked.state.player.team, match.state.player.team)
  assert.equal(masked.timeline[0].message, 'A**의 피카츄이(가) 전기타입으로 테라스탈했다!')
  for (const key of ['actorName', 'targetName', 'moveName', 'itemName', 'id']) assert.equal(masked.timeline[0][key], match.timeline[0][key])
  assert.ok(masked.state.log.every(entry => !entry.id.includes('Alexander') && !entry.id.includes('Amelia')))
  assert.notEqual(masked.state.log[0].id, masked.state.log[1].id, 'Different full names sharing an initial still need distinct log keys')
  assert.deepEqual(maskRankedMatch(masked), masked)
})

const team = ids => ids.map(speciesId => normalizePokemon({ speciesId, captureId: `privacy-${speciesId}` }))
test('new ranked engine states generate masked opening logs from the beginning', () => {
  const state = createRankedBattle({ playerTeam: team([25, 6, 9]), opponentTeam: team([143, 68, 131]), playerName: '신동수', opponentName: 'Alexander' })
  assert.equal(state.player.name, '신**'); assert.equal(state.opponent.name, 'A**')
  assert.ok(!JSON.stringify(state).includes('신동수'))
  assert.ok(!JSON.stringify(state).includes('Alexander'))
})

test('both ranked engine perspectives scrub legacy real names from current and animation snapshots', () => {
  const state = createRankedBattle({ playerTeam: team([25, 6, 9]), opponentTeam: team([143, 68, 131]) })
  state.player.name = '신동수'; state.opponent.name = 'Alexander'; state.opponentMeta.name = 'Alexander'
  state.log = [{ id: '1-0-신동수 vs Alexander, 레이팅 배틀 시작!', message: '신동수 vs Alexander, 레이팅 배틀 시작!', tone: 'opponent' },
    { id: '1-1-Alexander은(는) 피카츄을(를) 내보냈다!', message: 'Alexander은(는) 피카츄을(를) 내보냈다!', tone: 'opponent' }]
  const timeline = [{ id: '1-0-switch-out', phase: 'switch-out', sideId: 'opponent', actorSlot: 0, actorName: '잠만보', message: 'Alexander은(는) 잠만보을(를) 불러들였다!', state }]
  for (const side of ['player', 'opponent']) {
    const view = getRankedBattleView(state, side)
    const frames = getRankedTimelineView(timeline, side)
    assert.ok(!JSON.stringify({ view, frames }).includes('신동수'))
    assert.ok(!JSON.stringify({ view, frames }).includes('Alexander'))
    assert.equal(frames[0].actorName, '잠만보')
    assert.equal(frames[0].message, 'A**은(는) 잠만보을(를) 불러들였다!')
    assert.equal(view.player.name, side === 'player' ? '신**' : 'A**')
  }
  assert.equal(state.player.name, '신동수')
})

console.log(`Ranked privacy validation passed: ${passed}/${passed}`)
