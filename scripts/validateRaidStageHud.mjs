import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { createRaidBattle, getRaidBattleView, startRaidBossStage } from '../server/raidBattle.js'
import { normalizePokemon } from '../src/data/trainingData.js'

const vite = await createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' })
try {
  const { default: RaidBattleStage } = await vite.ssrLoadModule('/src/RaidBattleStage.jsx')
  const state = createRaidBattle({ raidId: 'hud-validation', bossId: 'hooh', members: [{ ownerId: 'hud-player', displayName: '검증', pokemon: normalizePokemon({ speciesId: 445 }) }] })
  const render = (battle, extra = {}) => renderToStaticMarkup(createElement(RaidBattleStage, {
    battle, raid: battle.raid, connected: true, secondsLeft: 65, statusText: '이번 턴의 행동을 선택하세요.', ...extra,
  }))
  const count = (markup, pattern) => [...markup.matchAll(pattern)].length
  const prelude = render(getRaidBattleView(state, 'hud-player'))
  assert.equal(count(prelude, /class="battle-game-header raid-standard-battle-header"/g), 1)
  assert.equal(count(prelude, /class="battle-status-anchor opponent-status-anchor/g), 3, 'All prelude opponents retain their individual HP')
  assert(prelude.includes('남은 행동 시간 1:05'))
  for (const label of ['이번 턴의 행동을 선택하세요.', 'raid-header-withdraw', '배틀 사운드 끄기', '환경 설정', 'rule-raid-weather', 'rule-raid-terrain']) assert(prelude.includes(label), label)
  assert(!prelude.includes('raid-online-bar'))

  state.opponent.team.forEach(actor => { actor.hp = 0; actor.fainted = true })
  const bossState = startRaidBossStage(state)
  const view = getRaidBattleView(bossState, 'hud-player')
  const bossHud = createElement('div', { className: 'raid-boss-hp' }, '보스 체력')
  const boss = render(view, { bossHud })
  assert.equal(count(boss, /class="raid-boss-hp"/g), 1, 'Main boss HP is shown exactly once in the center')
  assert.equal(count(boss, /class="battle-status-anchor opponent-status-anchor/g), 0, 'No duplicate standard HP panel for the boss')
  assert.equal(count(boss, /class="battle-status-anchor player-status-anchor/g), 3, 'All ally HP panels are preserved')
  assert(boss.includes('보스 진영 출전 포켓몬'), 'Boss party indicators are preserved')
  assert.equal(count(boss, /class="battle-pokemon-stage opponent/g), 1, 'Boss sprite remains visible')

  const summons = getRaidBattleView(state, 'hud-player').opponent.team.slice(0, 2).map((actor, index) => ({ ...actor, battleId: `summon-${index}`, actorId: `summon-${index}`, slot: index + 1, hp: actor.maxHp, fainted: false }))
  const withSummons = render({ ...view, opponent: { ...view.opponent, team: [...view.opponent.team, ...summons], activeIndexes: [0, 1, 2] } }, { bossHud })
  assert.equal(count(withSummons, /class="battle-status-anchor opponent-status-anchor/g), 2, 'Summoned adds retain separate HP bars')
  assert.equal(count(withSummons, /class="battle-pokemon-stage opponent/g), 3)

  const disconnected = render(view, { connected: false, statusText: '연결을 복구하고 있습니다.', secondsLeft: null })
  assert(disconnected.includes('남은 행동 시간 —'))
  assert(/raid-header-withdraw[^>]*disabled/.test(disconnected), 'Withdraw is disabled while reconnecting')
  assert(render(view, { secondsLeft: -1 }).includes('남은 행동 시간 0:00'))
  console.log('Raid stage HUD validation passed: one header, centralized boss HP, preserved prelude/summon/allied HP and controls.')
} finally {
  await vite.close()
}
