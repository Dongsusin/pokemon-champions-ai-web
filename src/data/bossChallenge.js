import { createBattle, createBattlePreviewPokemon } from './battleEngine.js'
import { getLearnableMoves, getSpeciesProfile, normalizePokemon } from './trainingData.js'
import { RAID_BOSSES } from './raidRules.js'

const roster = (ids, trainer) => ids.map(speciesId => ({ speciesId, trainer }))
export const BOSS_CHALLENGES = RAID_BOSSES.map(boss => ({
  ...boss,
  rounds: boss.id === 'mewtwo' ? [
    { name: '로사 / 로이', format: 'double', pokemon: roster([24, 110, 52, 202, 455, 469], '로사 / 로이') },
    { name: '비주기', format: 'single', pokemon: roster([53, 31, 34, 112, 51, 115], '비주기') },
  ] : boss.id === 'hooh' ? [
    { name: '랜스 / 란다', trainers: ['랜스', '란다'], format: 'double', pokemon: roster([42, 110, 89, 24, 44, 198], '랜스 / 란다') },
    { name: '엔테이 / 스이쿤 / 라이코', format: 'single', pokemon: [boss.stageOne[0], boss.stageOne[2], boss.stageOne[1]] },
  ] : [
    { name: '아테나 / 아폴로', trainers: ['아테나', '아폴로'], format: 'double', pokemon: roster([24, 45, 198, 229, 110, 169], '아테나 / 아폴로') },
    { name: '파이어 / 프리저 / 썬더', format: 'single', pokemon: [boss.stageOne[1], boss.stageOne[2], boss.stageOne[0]] },
  ],
})).map(boss => ({ ...boss, rounds: [...boss.rounds,
  { name: boss.name, format: 'single', pokemon: [{ speciesId: boss.speciesId, moves: boss.moves }] },
] })).map(boss => ({
  ...boss,
  // Story scenery is presentation metadata, independent of terrain and weather rules.
  rounds: boss.rounds.map((encounter, index) => ({
    ...encounter,
    background: {
      id: `${boss.id}-round-${index + 1}`,
      src: `/assets/boss-backgrounds/${boss.id}-round-${index + 1}.webp`,
    },
  })),
}))

export function createBossOpponent(entry, captureId) {
  const profile = getSpeciesProfile(entry.speciesId)
  const legal = getLearnableMoves(profile.id)
  // Use structured move metadata, preferring reliable attacks and type coverage.
  const selected = []
  for (const move of [...legal].filter(m => m.power > 0).sort((a, b) =>
    (Number(profile.types.includes(b.type)) * 60 + Math.min(b.power, 100)) -
    (Number(profile.types.includes(a.type)) * 60 + Math.min(a.power, 100)))) {
    if (!selected.some(m => m.type === move.type)) selected.push(move)
    if (selected.length === 4) break
  }
  for (const move of legal) {
    if (selected.length >= 4) break
    if (!selected.some(m => m.id === move.id)) selected.push(move)
  }
  const moves = entry.moves ? entry.moves.map(id => {
    const move = legal.find(m => m.id === id)
    if (!move) throw new Error(`${profile.name}: 사용할 수 없는 기술 ${id}`)
    return move.name
  }) : selected.map(m => m.name)
  return normalizePokemon({ speciesId: profile.id, captureId, moves, ability: profile.abilities[0], nature: '노력' })
}

export function createBossChallengeBattle({ bossId, round, party, playerName, previousPlayerTeam = null, random = Math.random }) {
  const challenge = BOSS_CHALLENGES.find(boss => boss.id === bossId)
  const encounter = challenge?.rounds[round - 1]
  if (!encounter || party?.length !== 6 || new Set(party.map(p => p.captureId)).size !== 6) {
    throw new Error('서로 다른 보유 포켓몬 6마리와 올바른 라운드를 선택해주세요.')
  }
  const playerHealth = round > 1 && previousPlayerTeam ? previousPlayerTeam.map(({ captureId, hp, maxHp, fainted }) => (
    { captureId, hp, maxHp, fainted }
  )) : null
  if (playerHealth && (playerHealth.length !== party.length
    || new Set(playerHealth.map(pokemon => pokemon.captureId)).size !== party.length
    || party.some(pokemon => !playerHealth.some(previous => previous.captureId === pokemon.captureId)))) {
    throw new Error('이전 배틀과 같은 팀으로 보스전을 이어가야 합니다.')
  }
  const slots = encounter.format === 'double' ? 2 : 1
  const rules = {
    weather: { id: 'clear', label: '맑음' }, terrain: { id: 'neutral', label: '일반 필드' },
    format: { id: encounter.format, label: slots === 2 ? '더블배틀' : '싱글배틀', activeSlots: slots, actionSlots: slots },
    teamRule: { id: 'full', label: `6대${encounter.pokemon.length}`, battleSize: 6 },
    gimmickRestriction: { id: null, label: '제한 없음' }, aiDifficulty: { id: 'normal' },
  }
  const portraitMembers = encounter.trainers?.map(name => ({ name })) ?? (
    round > 1 && encounter.name !== '비주기' ? encounter.pokemon.map(entry => {
      const profile = getSpeciesProfile(entry.speciesId)
      return { name: profile.name, spriteSources: [profile.spriteFront, profile.spriteFrontFallback].flat().filter(Boolean) }
    }) : undefined
  )
  const battle = createBattle({ playerPokemon: structuredClone(party), playerName, playerHealth,
    opponent: { id: `boss-${bossId}-${round}`, name: encounter.name, portraitMembers, tier: 'S', specialties: [] },
    opponentTeam: { pokemon: encounter.pokemon.map((p, i) => createBossOpponent(p, `boss-${round}-${i}`)), battleGimmicks: [], strategy: {} }, rules, random })
  if (round === 3) {
    const order = [0, 1, 2]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]
    }
    battle.raid = { campaign: true, raidId: `challenge-${bossId}`, bossId, phase: 3,
      primaryBossId: battle.opponent.team[0].battleId, crossedGates: [], firedMechanics: [], pendingGates: [],
      events: [], usedMechanicsByOwner: {}, reviveOrder: order, megaForm: random() < 0.5 ? 'mewtwo-mega-x' : 'mewtwo-mega-y',
      summonPool: challenge.id === 'hooh' ? challenge.rounds[1].pokemon.map((p, i) => {
        const actor = createBattlePreviewPokemon(createBossOpponent(p, `revival-${i}`))
        actor.battleId = `revival-${i}`
        return actor
      }) : [],
    }
  }
  return battle
}
