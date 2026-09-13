import {
  getLearnableMoves, getSpeciesProfile, isSavablePokemonForm, normalizePokemon,
  NATURE_OPTIONS, STAT_META, STAT_POINT_PER_STAT, STAT_POINT_TOTAL, TERA_TYPES,
} from './trainingData.js'
import { getBattleItem } from './shopData.js'

export const FACTORY_RANKING_LIMIT = 10
export const FACTORY_RANKING_MAX_FLOOR = 10000

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = message => { throw Object.assign(new Error(message), { code: 'FACTORY_RANKING_INVALID', status: 400 }) }
const hasOnlyKeys = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key))
const PARTY_FIELDS = ['speciesId', 'ability', 'nature', 'moves', 'heldItemId', 'teraType', 'dynamaxMode', 'trainingPoints']
const REPORT_FIELDS = ['runId', 'floor', 'wins', 'party', 'outcome', 'forfeited']

export function canonicalFactoryRankingParty(party) {
  if (!Array.isArray(party) || party.length !== 3) invalid('최종 렌탈 팀 3마리의 정보가 필요합니다.')
  const species = new Set()
  return party.map(entry => {
    if (!hasOnlyKeys(entry, PARTY_FIELDS)) invalid('포켓몬 설정 형식이 올바르지 않습니다.')
    if (!Number.isSafeInteger(entry.speciesId)) invalid('포켓몬 종 번호가 올바르지 않습니다.')
    const profile = getSpeciesProfile(entry.speciesId)
    if (!profile || !isSavablePokemonForm(profile)) invalid('등록할 수 없는 포켓몬 폼입니다.')
    const dexId = Number(profile.parentSpeciesId ?? profile.id)
    if (species.has(dexId)) invalid('같은 종류의 포켓몬을 중복 등록할 수 없습니다.')
    species.add(dexId)
    if (typeof entry.ability !== 'string' || !profile.abilities.includes(entry.ability)) invalid('포켓몬의 특성이 올바르지 않습니다.')
    if (!NATURE_OPTIONS.some(nature => nature.label === entry.nature)) invalid('포켓몬의 성격이 올바르지 않습니다.')
    if (!TERA_TYPES.includes(entry.teraType)) invalid('테라타입이 올바르지 않습니다.')
    if (!['dynamax', 'gigantamax'].includes(entry.dynamaxMode)) invalid('다이맥스 설정이 올바르지 않습니다.')
    if (typeof entry.heldItemId !== 'string' || entry.heldItemId.length > 96
      || (entry.heldItemId && !getBattleItem(entry.heldItemId))) invalid('지닌 도구가 올바르지 않습니다.')
    if (!Array.isArray(entry.moves) || entry.moves.length < 1 || entry.moves.length > 4
      || entry.moves.some(name => typeof name !== 'string' || name.length > 64)
      || new Set(entry.moves).size !== entry.moves.length) invalid('기술은 서로 다른 1~4개로 설정해야 합니다.')
    const learnable = new Set(getLearnableMoves(profile.id).map(move => move.name))
    if (entry.moves.some(name => !learnable.has(name))) invalid('해당 포켓몬이 배울 수 없는 기술입니다.')
    const statKeys = STAT_META.map(stat => stat.key)
    if (!hasOnlyKeys(entry.trainingPoints, statKeys)
      || statKeys.some(key => !Number.isSafeInteger(entry.trainingPoints[key]) || entry.trainingPoints[key] < 0 || entry.trainingPoints[key] > STAT_POINT_PER_STAT)
      || Object.values(entry.trainingPoints).reduce((sum, value) => sum + value, 0) > STAT_POINT_TOTAL) invalid('능력치 포인트가 올바르지 않습니다.')
    const normalized = normalizePokemon(entry)
    if (normalized.speciesId !== entry.speciesId || normalized.dynamaxMode !== entry.dynamaxMode
      || JSON.stringify(normalized.moves) !== JSON.stringify(entry.moves)) invalid('완성된 렌탈 설정만 기록할 수 있습니다.')
    return Object.fromEntries(PARTY_FIELDS.map(key => [key, structuredClone(normalized[key])]))
  })
}

export function validateFactoryRankingSubmission(report) {
  if (!hasOnlyKeys(report, REPORT_FIELDS)) invalid('배틀팩토리 기록 형식이 올바르지 않습니다.')
  if (typeof report.runId !== 'string' || !/^[a-zA-Z0-9_:-]{8,128}$/.test(report.runId)) invalid('도전 식별자가 올바르지 않습니다.')
  if (!Number.isSafeInteger(report.floor) || report.floor < 1 || report.floor > FACTORY_RANKING_MAX_FLOOR
    || !Number.isSafeInteger(report.wins) || report.wins !== report.floor - 1) invalid('도달 층수와 클리어 횟수가 올바르지 않습니다.')
  if (!['loss', 'draw'].includes(report.outcome) || typeof report.forfeited !== 'boolean'
    || (report.forfeited && report.outcome !== 'loss')) invalid('종료된 도전의 결과만 기록할 수 있습니다.')
  return {
    runId: report.runId, floor: report.floor, wins: report.wins,
    party: canonicalFactoryRankingParty(report.party),
    outcome: report.outcome, forfeited: report.forfeited,
  }
}

export function createFactoryRankingSubmission(run) {
  if (run?.phase !== 'finished' || !run.lastResult || run.lastResult.won !== false
    || run.lastResult.floor !== run.floor || run.lastResult.battleId !== run.battleId
    || run.battleId !== `${run.id}:floor:${run.floor}`
    || (!['opponent', 'draw'].includes(run.lastResult.winner) && !run.lastResult.forfeited)) invalid('배틀팩토리 도전이 종료된 뒤 기록할 수 있습니다.')
  return validateFactoryRankingSubmission({
    runId: run.id, floor: run.floor, wins: run.wins,
    party: Array.isArray(run.party) ? run.party.map(entry => Object.fromEntries(PARTY_FIELDS.map(key => [key, entry[key]]))) : run.party,
    outcome: run.lastResult.forfeited || run.lastResult.winner === 'opponent' ? 'loss' : 'draw',
    forfeited: Boolean(run.lastResult.forfeited),
  })
}

export function compareFactoryRankingEntries(first, second) {
  return second.floor - first.floor || first.recordedAt - second.recordedAt
}

export function sortFactoryRankingEntries(entries) {
  // Stable sorting keeps the earlier accepted record ahead when server times
  // share the same millisecond. Callers append newly accepted records last.
  return [...entries].sort(compareFactoryRankingEntries).slice(0, FACTORY_RANKING_LIMIT)
}

export function chooseFactoryPersonalBest(previous, candidate) {
  return !previous || candidate.floor > previous.floor ? candidate : previous
}
