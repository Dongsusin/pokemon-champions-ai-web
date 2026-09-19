import { getMove, getSpeciesProfile, resolveMoveForPokemon } from './trainingData.js'
import { getBattleItem } from './shopData.js'
import { getTypeEffectiveness } from './battleEngine.js'

const TYPES = ['노말', '불꽃', '물', '전기', '풀', '얼음', '격투', '독', '땅', '비행', '에스퍼', '벌레', '바위', '고스트', '드래곤', '악', '강철', '페어리']
const ALLY_ONLY = new Set(['adjacentAlly', 'adjacentAllyOrSelf', 'allies'])
const WEATHER = { 가뭄: 'sun', 끝의대지: 'sun', 잔비: 'rain', 시작의바다: 'rain', 모래날림: 'sand', 눈퍼뜨리기: 'snow' }
const WEATHER_BENEFIT = { 쓱쓱: 'rain', 건조피부: 'rain', 엽록소: 'sun', 선파워: 'sun', 모래헤치기: 'sand', 눈치우기: 'snow' }

export function getFactoryDifficulty(floor, mode = 'standard') {
  const value = Number(floor)
  const level = Number.isFinite(value) ? Math.max(1, Math.min(10000, Math.floor(value))) : 1
  const challenge = mode === 'challenge'
  // Tighten the eligible species pool continuously, then cap it so deep runs
  // retain varied opponents rather than converging on the same three species.
  const progress = Math.min(1, (level - 1) / (challenge ? 59 : 79))
  return {
    floor: level, mode: challenge ? 'challenge' : 'standard',
    minPercentile: (challenge ? 0.55 : 0.4) + progress * (challenge ? 0.39 : 0.52),
    teamCandidates: Math.round(12 + progress * 36 + (challenge ? 8 : 0)),
    setCandidates: progress >= 0.5 ? 4 : 3,
    label: progress >= 0.75 ? '최상급' : progress >= 0.4 ? '상급' : '정예',
  }
}

const factsCache = new WeakMap()
function setFacts(pokemon) {
  if (factsCache.has(pokemon)) return factsCache.get(pokemon)
  const profile = getSpeciesProfile(pokemon.speciesId)
  const moves = (pokemon.moves ?? []).map(name => resolveMoveForPokemon(getMove(name), pokemon)).filter(Boolean)
  const attacks = moves.filter(move => move.category !== '변화')
  const facts = { profile, moves, attacks, stats: profile?.stats ?? [0, 0, 0, 0, 0, 0] }
  factsCache.set(pokemon, facts)
  return facts
}

export function scoreFactorySet(pokemon, gimmicks = []) {
  const { profile, moves, attacks, stats } = setFacts(pokemon)
  if (!profile) return -10000
  const [hp, attack, defense, specialAttack, specialDefense, speed] = stats
  let score = stats.reduce((sum, stat) => sum + stat, 0)
    + Math.max(attack, specialAttack) * 0.55 + speed * 0.25
    + Math.sqrt(hp * (defense + specialDefense) / 2) * 0.25
  // Reward a usable singles loadout, not just a high base-stat total.
  if (!attacks.length) score -= 180
  score += Math.min(3, new Set(attacks.map(move => move.type)).size) * 18
  if (attacks.some(move => profile.types.includes(move.type))) score += 25
  for (const move of attacks) {
    const offense = move.category === '물리' ? attack : specialAttack
    score += Math.min(120, move.power || (move.damage ? 70 : 30)) * Math.min(1, (move.accuracy ?? 100) / 100) * offense / Math.max(attack, specialAttack) * 0.12
    if (offense < Math.max(attack, specialAttack) * 0.65) score -= 18
  }
  score -= moves.filter(move => ALLY_ONLY.has(move.target)).length * 70
  if (moves.some(move => move.heal)) score += 12
  if (moves.some(move => move.selfSwitch)) score += 12
  const item = getBattleItem(pokemon.heldItemId)
  if (item) score += 24
  if (String(pokemon.heldItemId).startsWith('choice-')) {
    score -= moves.filter(move => move.category === '변화' && !['trick', 'switcheroo'].includes(move.id)).length * 35
  }
  score += Math.min(66, Object.values(pokemon.trainingPoints ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0)) * 0.4
  // Only credit transformations actually configured for this rental.
  const formGain = Math.max(0, ...gimmicks.map(gimmick => {
    const form = getSpeciesProfile(gimmick.targetFormId)
    return form ? form.stats.reduce((sum, stat) => sum + stat, 0) - stats.reduce((sum, stat) => sum + stat, 0) : 0
  }))
  score += Math.min(100, formGain) * 0.5
  if (profile.isLegendary || profile.isMythical) score += 20
  // Large printed stats do not make these restrictive abilities reliable.
  if (pokemon.ability === '게으름') score -= 220
  if (pokemon.ability === '슬로스타트') score -= 180
  if (pokemon.ability === '무기력') score -= 100
  if (['천하장사', '순수한힘'].includes(pokemon.ability) && attacks.some(move => move.category === '물리')) score += attack * 0.75
  return score
}

export function scoreFactoryTeam(pokemon) {
  const facts = pokemon.map(setFacts)
  let score = pokemon.reduce((sum, entry) => sum + scoreFactorySet(entry, entry.factoryGimmicks), 0) / pokemon.length
  score += Math.min(9, new Set(facts.flatMap(fact => fact.attacks.map(move => move.type))).size) * 10
  const physical = facts.some(fact => fact.attacks.some(move => move.category === '물리' && fact.stats[1] >= 90))
  const special = facts.some(fact => fact.attacks.some(move => move.category === '특수' && fact.stats[3] >= 90))
  if (physical && special) score += 35
  for (const type of TYPES) {
    const matchups = facts.map(fact => getTypeEffectiveness(type, fact.profile?.types ?? []))
    const weak = matchups.filter(value => value > 1).length
    const resist = matchups.filter(value => value < 1).length
    if (weak >= 2) score -= (weak - 1) * (resist ? 12 : 35)
    if (weak && resist) score += 5
  }
  const weather = pokemon.map(entry => WEATHER[entry.ability]).filter(Boolean)
  if (new Set(weather).size > 1) score -= 90
  for (const entry of pokemon) {
    const benefit = WEATHER_BENEFIT[entry.ability]
    if (benefit && weather.includes(benefit)) score += 25
    if (benefit && weather.length && !weather.includes(benefit)) score -= 25
  }
  // Ordinary sun/rain persists after switching in singles. Strong primal
  // weather ends with its setter, so it must not penalize the next partner.
  const persistentWeather = pokemon.map(entry => ({ 가뭄: 'sun', 잔비: 'rain' })[entry.ability]).filter(Boolean)
  for (const fact of facts) {
    if (persistentWeather.includes('rain') && fact.profile?.types.includes('불꽃') && fact.attacks.some(move => move.type === '불꽃')) score -= 20
    if (persistentWeather.includes('sun') && fact.profile?.types.includes('물') && fact.attacks.some(move => move.type === '물')) score -= 20
  }
  // Three identical types and three identical held items make brittle teams.
  score += new Set(facts.flatMap(fact => fact.profile?.types ?? [])).size * 8
  const items = pokemon.map(entry => entry.heldItemId).filter(Boolean)
  score -= (items.length - new Set(items).size) * 18
  return score
}
