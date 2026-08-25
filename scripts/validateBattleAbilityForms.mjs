import assert from 'node:assert/strict'
import pokemonData from '../src/data/generatedPokemonData.json' with { type: 'json' }
import {
  chooseAiAction,
  createBattle,
  createBattleTurnTimeline,
  getAvailableBattleMechanics,
  getBattleMovePreview,
  getBattleTypeEffectiveness,
  getEffectiveBattleStat,
  playBattleTurnWithActions,
} from '../src/data/battleEngine.js'
import { getLearnableMoves, getMoveById } from '../src/data/trainingData.js'

const profiles = [...pokemonData.species, ...pokemonData.forms]
const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]))

function pokemon(slug, moveIds = ['protect'], overrides = {}) {
  const profile = profileBySlug.get(slug)
  assert(profile, `Missing species fixture: ${slug}`)
  const learnableMoveIds = new Set(getLearnableMoves(profile.id).map((move) => move.id))
  const moves = moveIds.map((moveId) => {
    const move = getMoveById(moveId)
    assert(move, `Missing move fixture: ${moveId}`)
    assert(learnableMoveIds.has(moveId), `${slug} cannot learn fixture move: ${moveId}`)
    return move
  })
  return {
    captureId: `ability-${slug}-${Math.random()}`,
    speciesId: profile.id,
    slug: profile.slug,
    ability: profile.abilities[0],
    moves: moves.map((move) => move.name),
    moveIds: moves.map((move) => move.id),
    ...overrides,
  }
}

function rules({ weather = 'clear', terrain = 'neutral' } = {}) {
  const weatherLabels = { clear: '맑음', rain: '비', snow: '설경', sun: '쾌청' }
  const terrainLabels = { electric: '일렉트릭필드', grassy: '그래스필드', neutral: '일반 필드' }
  return {
    weather: { id: weather, label: weatherLabels[weather] ?? weather },
    terrain: { id: terrain, label: terrainLabels[terrain] ?? terrain },
    format: { id: 'single', label: '싱글배틀', activeSlots: 1, actionSlots: 1 },
    teamRule: { id: 'full', label: '6대6', battleSize: 6 },
    disabledGimmickId: null,
    gimmickRestriction: { id: null, label: '제한 없음' },
  }
}

function battle(playerPokemon, opponentPokemon, battleRules = rules()) {
  return createBattle({
    playerPokemon,
    opponent: { name: 'ABILITY TEST', tier: 'S' },
    opponentTeam: {
      pokemon: opponentPokemon,
      battleGimmicks: [],
      strategy: { lead: opponentPokemon[0]?.name },
    },
    rules: battleRules,
  })
}

function turn(state, playerAction, opponentAction) {
  return playBattleTurnWithActions(
    state,
    [{ actorSlot: 0, targetSlot: 0, gimmick: null, ...playerAction }],
    [{ actorSlot: 0, targetSlot: 0, gimmick: null, ...opponentAction }],
    () => 0.5,
  )
}

{
  let state = battle(
    [pokemon('groudon-primal'), pokemon('snorlax')],
    [pokemon('greninja', ['surf', 'raindance'])],
  )
  assert.equal(state.rules.weather.id, 'desolateland')
  const hpBeforeWaterMove = state.player.team[0].hp
  state = turn(
    state,
    { type: 'move', moveIndex: 0 },
    { type: 'move', moveIndex: 0 },
  )
  assert.equal(state.player.team[0].hp, hpBeforeWaterMove)
  assert(state.log.some((entry) => entry.message.includes('사라져 버렸다')))

  state = turn(
    state,
    { type: 'move', moveIndex: 0 },
    { type: 'move', moveIndex: 1 },
  )
  assert.equal(state.rules.weather.id, 'desolateland')
  assert(!state.log.some((entry) => entry.message.includes('전술 효과가 전개되었다')))

  state = turn(
    state,
    { type: 'switch', targetIndex: 1 },
    { type: 'move', moveIndex: 0 },
  )
  assert.equal(state.rules.weather.id, 'clear')
}

{
  const state = battle(
    [pokemon('kyogre-primal')],
    [pokemon('charizard', ['flamethrower'])],
  )
  const hpBeforeFireMove = state.player.team[0].hp
  const nextState = turn(
    state,
    { type: 'move', moveIndex: 0 },
    { type: 'move', moveIndex: 0 },
  )
  assert.equal(nextState.rules.weather.id, 'primordialsea')
  assert.equal(nextState.player.team[0].hp, hpBeforeFireMove)
}

{
  const state = battle(
    [pokemon('castform', ['weatherball'])],
    [pokemon('rayquaza-mega')],
  )
  assert.equal(state.rules.weather.id, 'deltastream')
  assert.equal(getBattleTypeEffectiveness(state, '얼음', ['드래곤', '비행']), 2)
  assert.equal(getBattleTypeEffectiveness(state, '전기', ['드래곤', '비행']), 0.5)
  assert.equal(getBattleMovePreview(state, 'player', 0).type, '노말')
  assert.equal(getBattleMovePreview(state, 'player', 0).power, 50)
}

{
  const state = battle(
    [pokemon('rayquaza', ['dragonascent'])],
    [pokemon('snorlax')],
  )
  assert(getAvailableBattleMechanics(state, 'player', 0).some((mechanic) => mechanic.id === 'mega'))
  const nextState = turn(
    state,
    { type: 'move', moveIndex: 0, gimmick: 'mega' },
    { type: 'move', moveIndex: 0 },
  )
  assert.equal(nextState.player.team[0].speciesId, profileBySlug.get('rayquaza-mega').id)
  assert.equal(nextState.rules.weather.id, 'deltastream')
}

{
  let state = battle(
    [pokemon('aegislash', ['shadowball', 'kingsshield'])],
    [pokemon('snorlax', ['tackle'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 2000
  const formTurn = createBattleTurnTimeline(
    state,
    { type: 'move', moveIndex: 0, actorSlot: 0, targetSlot: 0, gimmick: null },
    () => 0.5,
  )
  const formStep = formTurn.timeline.find((step) => step.phase === 'form' && step.sideId === 'player')
  assert(formStep, 'Stance Change must emit a form-change timeline step')
  assert(formStep.spriteBeforeBack.includes('/aegislash.gif'))
  assert(formStep.spriteAfterBack.includes('/aegislash-blade.gif'))
  state = formTurn.state
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('aegislash-blade').id)
  state = turn(state, { type: 'move', moveIndex: 1 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('aegislash').id)
}

{
  let state = battle([pokemon('wishiwashi')], [pokemon('snorlax')])
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('wishiwashi-school').id)
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp / 4)
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('wishiwashi').id)
}

{
  let state = battle([pokemon('zygarde-50-power-construct')], [pokemon('snorlax')])
  const oldMaxHp = state.player.team[0].maxHp
  state.player.team[0].hp = Math.floor(oldMaxHp / 2)
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('zygarde-complete').id)
  assert(state.player.team[0].maxHp > oldMaxHp)
  assert.equal(state.player.team[0].maxHp - state.player.team[0].hp, oldMaxHp - Math.floor(oldMaxHp / 2))
}

{
  let state = battle(
    [pokemon('darmanitan', ['protect'], { ability: '달마모드' })],
    [pokemon('snorlax')],
  )
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp / 2)
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('darmanitan-zen').id)
}

{
  let state = battle(
    [pokemon('darmanitan-galar-standard', ['protect'], { ability: '달마모드' })],
    [pokemon('snorlax')],
  )
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp / 2)
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('darmanitan-galar-zen').id)
}

{
  let state = battle([pokemon('minior')], [pokemon('snorlax')])
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp / 2)
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('minior-red').id)
}

{
  let state = battle([pokemon('morpeko')], [pokemon('snorlax')])
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('morpeko-hangry').id)
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('morpeko').id)
}

{
  const state = battle([pokemon('castform')], [pokemon('snorlax')], rules({ weather: 'sun' }))
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('castform-sunny').id)
}

{
  const rainy = battle([pokemon('castform')], [pokemon('snorlax')], rules({ weather: 'rain' }))
  assert.equal(rainy.player.team[0].speciesId, profileBySlug.get('castform-rainy').id)
  const snowy = battle([pokemon('castform')], [pokemon('snorlax')], rules({ weather: 'snow' }))
  assert.equal(snowy.player.team[0].speciesId, profileBySlug.get('castform-snowy').id)
}

{
  let state = battle(
    [pokemon('castform', ['sunnyday', 'protect'])],
    [
      pokemon('golduck', ['protect'], { ability: '날씨부정' }),
      pokemon('snorlax', ['protect']),
    ],
    rules({ weather: 'sun' }),
  )
  state.opponent.activeIndexes = [0]
  state.opponent.activeIndex = 0
  state = turn(
    state,
    { type: 'move', moveIndex: 0 },
    { type: 'move', moveIndex: 0 },
  )
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('castform').id)
  state = turn(
    state,
    { type: 'move', moveIndex: 1 },
    { type: 'switch', targetIndex: 1 },
  )
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('castform-sunny').id)
}

{
  const state = battle(
    [pokemon('cherrim')],
    [pokemon('groudon-primal')],
  )
  const cherrim = state.player.team[0]
  assert.equal(state.rules.weather.id, 'desolateland')
  assert.equal(cherrim.slug, 'cherrim-sunshine')
  assert(cherrim.spriteFront.includes('/cherrim-sunshine.gif'))
  assert(cherrim.spriteBack.includes('/cherrim-sunshine.gif'))
  assert.equal(getEffectiveBattleStat(state, cherrim, 'attack'), cherrim.stats.attack * 1.5)
  assert.equal(getEffectiveBattleStat(state, cherrim, 'specialDefense'), cherrim.stats.specialDefense * 1.5)
}

{
  const state = battle(
    [pokemon('cherrim', ['sunnyday'])],
    [pokemon('snorlax', ['protect'])],
  )
  const weatherTurn = createBattleTurnTimeline(
    state,
    { type: 'move', moveIndex: 0, actorSlot: 0, targetSlot: 0, gimmick: null },
    () => 0.5,
  )
  const formStep = weatherTurn.timeline.find((step) => step.phase === 'form' && step.sideId === 'player')
  assert(formStep, 'Flower Gift weather activation must emit a form-change timeline step')
  assert(formStep.spriteBeforeBack.includes('/cherrim.gif'))
  assert(formStep.spriteAfterBack.includes('/cherrim-sunshine.gif'))
  assert.equal(weatherTurn.state.player.team[0].slug, 'cherrim-sunshine')
}

{
  const state = battle([pokemon('mimikyu', ['swordsdance'])], [pokemon('snorlax', ['bite'])])
  const hpBefore = state.player.team[0].hp
  const nextState = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(nextState.player.team[0].speciesId, profileBySlug.get('mimikyu-busted').id)
  assert.equal(nextState.player.team[0].hp, hpBefore - Math.floor(hpBefore / 8))
}

{
  let state = battle(
    [pokemon('eiscue', ['tackle', 'snowscape'])],
    [pokemon('snorlax', ['tackle', 'protect'])],
  )
  const hpBefore = state.player.team[0].hp
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].hp, hpBefore)
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('eiscue-noice').id)
  state = turn(state, { type: 'move', moveIndex: 1 }, { type: 'move', moveIndex: 1 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('eiscue').id)
}

{
  let state = battle(
    [pokemon('cramorant', ['surf', 'raindance'])],
    [pokemon('snorlax', ['protect', 'tackle'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 2000
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('cramorant-gulping').id)
  const opponentHpBeforeMissile = state.opponent.team[0].hp
  state = turn(state, { type: 'move', moveIndex: 1 }, { type: 'move', moveIndex: 1 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('cramorant').id)
  assert(state.opponent.team[0].hp < opponentHpBeforeMissile)
  assert.equal(state.opponent.team[0].statStages.defense, -1)
}

{
  let state = battle(
    [pokemon('palafin'), pokemon('snorlax')],
    [pokemon('snorlax')],
  )
  state = turn(state, { type: 'switch', targetIndex: 1 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('palafin-hero').id)
}

{
  let state = battle(
    [pokemon('terapagos')],
    [pokemon('snorlax')],
    rules({ weather: 'rain', terrain: 'electric' }),
  )
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('terapagos-terastal').id)
  state = turn(
    state,
    { type: 'move', moveIndex: 0, gimmick: 'tera' },
    { type: 'move', moveIndex: 0 },
  )
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('terapagos-stellar').id)
  assert.equal(state.rules.weather.id, 'clear')
  assert.equal(state.rules.terrain.id, 'neutral')
}

{
  let state = battle(
    [pokemon('terapagos', ['raindance'])],
    [pokemon('snorlax', ['tackle'])],
  )
  const fullHp = state.player.team[0].hp
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  const firstDamage = fullHp - state.player.team[0].hp
  const hpBeforeSecondHit = state.player.team[0].hp
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  const secondDamage = hpBeforeSecondHit - state.player.team[0].hp
  assert(firstDamage > 0)
  assert(secondDamage > firstDamage)
}

{
  const state = battle(
    [pokemon('arceus', ['protect'], { heldItemId: 'flame-plate' })],
    [pokemon('snorlax')],
  )
  assert.deepEqual(state.player.team[0].types, ['불꽃'])
}

{
  const state = battle(
    [pokemon('arceus', ['judgment'], { heldItemId: 'firium-z--held' })],
    [pokemon('snorlax')],
  )
  assert.deepEqual(state.player.team[0].types, ['불꽃'])
  assert.equal(getBattleMovePreview(state, 'player', 0).type, '불꽃')
}

{
  const state = battle(
    [pokemon('silvally', ['multiattack'], { heldItemId: 'water-memory' })],
    [pokemon('snorlax')],
  )
  assert.deepEqual(state.player.team[0].types, ['물'])
  assert.equal(getBattleMovePreview(state, 'player', 0).type, '물')
}

{
  const state = battle(
    [pokemon('stunfisk-galar')],
    [pokemon('snorlax')],
    rules({ terrain: 'grassy' }),
  )
  assert.deepEqual(state.player.team[0].types, ['풀'])
}

{
  const state = battle(
    [pokemon('great-tusk', ['protect'], { heldItemId: 'booster-energy' })],
    [pokemon('snorlax')],
  )
  assert.equal(state.player.team[0].consumedItem, true)
  assert.equal(state.player.team[0].paradoxBoosterActive, true)
}

{
  const zacianState = battle(
    [pokemon('zacian', ['protect'], { heldItemId: 'rusted-sword', heldItemName: '녹슨검' })],
    [pokemon('snorlax')],
  )
  assert.equal(zacianState.player.team[0].speciesId, profileBySlug.get('zacian-crowned').id)
  assert(zacianState.player.team[0].spriteFront.includes('/zacian-crowned.gif'))

  const zamazentaState = battle(
    [pokemon('zamazenta', ['protect'], { heldItemId: 'rusted-shield', heldItemName: '녹슨방패' })],
    [pokemon('snorlax')],
  )
  assert.equal(zamazentaState.player.team[0].speciesId, profileBySlug.get('zamazenta-crowned').id)
  assert(zamazentaState.player.team[0].spriteFront.includes('/zamazenta-crowned.gif'))
}

{
  const state = battle(
    [
      pokemon('snorlax'),
      pokemon('zacian', ['protect'], { heldItemId: 'rusted-sword', heldItemName: '녹슨검' }),
    ],
    [pokemon('snorlax')],
  )
  const switchTurn = createBattleTurnTimeline(
    state,
    { type: 'switch', targetIndex: 1, actorSlot: 0 },
    () => 0.5,
  )
  const switchStepIndex = switchTurn.timeline.findIndex((step) => step.phase === 'switch' && step.sideId === 'player')
  const formStepIndex = switchTurn.timeline.findIndex((step) => step.phase === 'form' && step.sideId === 'player')
  assert(switchStepIndex >= 0)
  assert(formStepIndex > switchStepIndex, 'Held-item form animation must follow the send-out animation')
  const formStep = switchTurn.timeline[formStepIndex]
  assert(formStep.spriteBeforeBack.includes('/zacian.gif'))
  assert(formStep.spriteAfterBack.includes('/zacian-crowned.gif'))
}

{
  const state = battle(
    [pokemon('genesect', ['protect'], { heldItemId: 'douse-drive', heldItemName: '아쿠아카세트' })],
    [pokemon('snorlax')],
  )
  assert.equal(state.player.team[0].slug, 'genesect-douse')
  assert(state.player.team[0].spriteFront.includes('/genesect-douse.gif'))
  assert(state.player.team[0].spriteBack.includes('/genesect-douse.gif'))
}

{
  let state = battle(
    [pokemon('zacian'), pokemon('snorlax')],
    [pokemon('snorlax')],
  )
  assert.equal(state.player.team[0].statStages.attack, 1)
  state = turn(state, { type: 'switch', targetIndex: 1 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].statStages.attack, 0)
  state = turn(state, { type: 'switch', targetIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].statStages.attack, 0)
  assert.equal(state.player.team[0].entryAbilityActivations['불요의검'], 1)
}

{
  const state = battle(
    [pokemon('porygon-z', ['protect'], { ability: '다운로드' })],
    [pokemon('snorlax')],
  )
  assert.equal(state.player.team[0].statStages.attack, 1)
  assert.equal(state.player.team[0].statStages.specialAttack, 0)
}

{
  let state = battle(
    [pokemon('dipplin'), pokemon('snorlax')],
    [pokemon('snorlax')],
  )
  assert.equal(state.opponent.team[0].statStages.evasion, -1)
  state = turn(state, { type: 'switch', targetIndex: 1 }, { type: 'move', moveIndex: 0 })
  state = turn(state, { type: 'switch', targetIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.opponent.team[0].statStages.evasion, -1)
}

{
  let state = battle(
    [pokemon('klawf', ['raindance'], { ability: '분노의껍질' })],
    [pokemon('snorlax', ['tackle'])],
  )
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp / 2) + 1
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].statStages.attack, 1)
  assert.equal(state.player.team[0].statStages.defense, -1)
  assert.equal(state.player.team[0].statStages.specialAttack, 1)
  assert.equal(state.player.team[0].statStages.specialDefense, -1)
  assert.equal(state.player.team[0].statStages.speed, 1)
}

{
  let state = battle(
    [pokemon('drampa', ['raindance'], { ability: '발끈' })],
    [pokemon('snorlax', ['tackle'])],
  )
  state.player.team[0].hp = Math.floor(state.player.team[0].maxHp / 2) + 1
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].statStages.specialAttack, 1)
}

{
  let state = battle(
    [pokemon('mienshao', ['protect'], { ability: '재생력' }), pokemon('snorlax')],
    [pokemon('snorlax')],
  )
  const mienshao = state.player.team[0]
  mienshao.hp = Math.floor(mienshao.maxHp / 3)
  const hpBeforeSwitch = mienshao.hp
  const maxHpBeforeSwitch = mienshao.maxHp
  state = turn(state, { type: 'switch', targetIndex: 1 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].hp, hpBeforeSwitch + Math.floor(maxHpBeforeSwitch / 3))
}

{
  let state = battle(
    [pokemon('blissey', ['protect']), pokemon('snorlax')],
    [pokemon('snorlax')],
  )
  state.player.team[0].status = { id: 'poison', label: '독', toxicCounter: 0 }
  state = turn(state, { type: 'switch', targetIndex: 1 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].status, null)
}

{
  let state = battle(
    [pokemon('regigigas', ['protect'])],
    [pokemon('snorlax', ['protect'])],
  )
  const regigigas = state.player.team[0]
  assert.equal(getEffectiveBattleStat(state, regigigas, 'attack'), regigigas.stats.attack * 0.5)
  for (let turnIndex = 0; turnIndex < 5; turnIndex += 1) {
    state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  }
  assert.equal(state.player.team[0].activeTurnCount, 5)
  assert.equal(getEffectiveBattleStat(state, state.player.team[0], 'attack'), state.player.team[0].stats.attack)
}

{
  const createKingambitBattle = (faintedBench) => {
    const state = battle(
      [
        pokemon('kingambit', ['kowtowcleave'], { ability: '총대장' }),
        ...Array.from({ length: 5 }, (_, index) => (
          pokemon('snorlax', ['protect'], { captureId: `overlord-bench-${faintedBench}-${index}` })
        )),
      ],
      [pokemon('snorlax', ['raindance'])],
    )
    state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
    if (faintedBench) {
      state.player.team.slice(1).forEach((entry) => {
        entry.hp = 0
        entry.fainted = true
      })
    }
    return state
  }
  const normalState = createKingambitBattle(false)
  const boostedState = createKingambitBattle(true)
  const normalResult = turn(normalState, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  const boostedResult = turn(boostedState, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  const normalDamage = 5000 - normalResult.opponent.team[0].hp
  const boostedDamage = 5000 - boostedResult.opponent.team[0].hp
  assert(boostedDamage > normalDamage)
}

{
  const state = battle(
    [pokemon('gardevoir', ['protect'], { ability: '트레이스' })],
    [pokemon('groudon-primal')],
  )
  assert.equal(state.player.team[0].ability, '끝의대지')
  assert.equal(state.rules.weather.id, 'desolateland')
}

{
  let state = battle(
    [pokemon('gliscor', ['protect'], { ability: '포이즌힐' })],
    [pokemon('snorlax', ['protect'])],
  )
  const gliscor = state.player.team[0]
  gliscor.hp = Math.floor(gliscor.maxHp / 2)
  gliscor.status = { id: 'poison', label: '독', toxicCounter: 0 }
  const expectedHp = gliscor.hp + Math.floor(gliscor.maxHp / 8)
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].hp, expectedHp)
}

{
  let state = battle(
    [pokemon('blaziken', ['protect'], { ability: '가속' })],
    [pokemon('snorlax', ['protect'])],
  )
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].statStages.speed, 1)
}

{
  const simpleState = battle(
    [pokemon('bidoof', ['protect'], { ability: '단순' })],
    [pokemon('gyarados', ['protect'], { ability: '위협' })],
  )
  assert.equal(simpleState.player.team[0].statStages.attack, -2)
  const contraryState = battle(
    [pokemon('spinda', ['protect'], { ability: '심술꾸러기' })],
    [pokemon('gyarados', ['protect'], { ability: '위협' })],
  )
  assert.equal(contraryState.player.team[0].statStages.attack, 1)
}

{
  let state = battle(
    [pokemon('krookodile', ['crunch'], { ability: '자기과신' })],
    [
      pokemon('snorlax', ['raindance']),
      pokemon('snorlax', ['protect'], { captureId: 'moxie-backup' }),
    ],
  )
  state.opponent.team[0].hp = 1
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].statStages.attack, 1)
}

{
  let state = battle(
    [pokemon('magearna', ['protect'])],
    [
      pokemon('snorlax', ['selfdestruct']),
      pokemon('snorlax', ['protect'], { captureId: 'soul-heart-backup' }),
    ],
  )
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].statStages.specialAttack, 1)
}

{
  const state = battle(
    [pokemon('ditto', ['transform'], { ability: '괴짜' })],
    [pokemon('pikachu', ['protect'])],
  )
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('pikachu').id)
  assert(state.player.team[0].transformSnapshot)
}

{
  let state = battle(
    [pokemon('meloetta', ['relicsong'])],
    [pokemon('snorlax', ['tackle'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 2000
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('meloetta-pirouette').id)
}

{
  let state = battle(
    [pokemon('greninja-battle-bond', ['watershuriken'])],
    [pokemon('snorlax', ['tackle']), pokemon('snorlax', ['protect'], { captureId: 'ability-snorlax-backup' })],
  )
  state.opponent.team[0].hp = 1
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].speciesId, profileBySlug.get('greninja-ash').id)
}

{
  let state = battle(
    [pokemon('slaking', ['scratch'])],
    [pokemon('snorlax', ['raindance'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  const startingPp = state.player.team[0].moves[0].currentPp

  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  const hpAfterFirstMove = state.opponent.team[0].hp
  assert(hpAfterFirstMove < 5000)
  assert.equal(state.player.team[0].moves[0].currentPp, startingPp - 1)
  assert.equal(state.player.team[0].truantLoafing, true)

  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.opponent.team[0].hp, hpAfterFirstMove)
  assert.equal(state.player.team[0].moves[0].currentPp, startingPp - 1)
  assert.equal(state.player.team[0].truantLoafing, false)
  assert(state.log.some((entry) => entry.message.includes('게으름') && entry.message.includes('농땡이')))

  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert(state.opponent.team[0].hp < hpAfterFirstMove)
  assert.equal(state.player.team[0].moves[0].currentPp, startingPp - 2)
}

{
  let state = battle(
    [pokemon('slaking', ['hyperbeam']), pokemon('snorlax', ['protect'])],
    [pokemon('snorlax', ['raindance'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000

  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].rechargeTurns, 1)
  assert.equal(state.player.team[0].truantLoafing, true)

  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].rechargeTurns, 0)
  assert.equal(state.player.team[0].truantLoafing, false)

  state = turn(state, { type: 'switch', targetIndex: 1 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].truantLoafing, false)
  state = turn(state, { type: 'switch', targetIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].truantLoafing, false)
}

{
  let state = battle(
    [pokemon('slaking', ['scratch']), pokemon('snorlax', ['protect'])],
    [pokemon('snorlax', ['raindance'])],
  )
  state.opponent.team[0].hp = state.opponent.team[0].maxHp = 5000
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].truantLoafing, true)
  state = turn(state, { type: 'switch', targetIndex: 1 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.player.team[0].truantLoafing, false)
  state = turn(state, { type: 'switch', targetIndex: 0 }, { type: 'move', moveIndex: 0 })
  const hpBeforeReturnMove = state.opponent.team[0].hp
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert(state.opponent.team[0].hp < hpBeforeReturnMove)
}

{
  let state = battle(
    [pokemon('snorlax', ['protect'])],
    [pokemon('slaking', ['scratch']), pokemon('snorlax', ['protect'])],
  )
  state.opponent.activeIndexes = [0]
  state.opponent.activeIndex = 0
  state = turn(state, { type: 'move', moveIndex: 0 }, { type: 'move', moveIndex: 0 })
  assert.equal(state.opponent.team[0].truantLoafing, true)
  const action = chooseAiAction(state, () => 0.5)
  assert.equal(action.type, 'switch')
  assert.equal(action.targetIndex, 1)
}

console.log('Validated weather, battle-state forms, and action-limiting abilities.')
