import { createEmptyUsageSnapshot, assertUsageBucket, recordUsageTeams, usageBucketKey } from '../data/pokemonUsage.js'
import { getRankedFormat } from '../data/rankedRules.js'
import { LOCAL_USAGE_KEY } from './saveSchema.js'

export function rankedUsageReport(match) {
  const team = match?.state?.player?.team
  if (match?.phase !== 'finished' || !match.id || !Array.isArray(team)
    || team.length !== getRankedFormat(match.format)?.battleSize) return null
  return { battleId: match.id, format: match.format, team, speciesIds: team.map(member => member.speciesId) }
}

export function createLocalUsageStore(storage) {
  function read() {
    const raw = storage.getItem(LOCAL_USAGE_KEY)
    if (!raw) return { snapshot: { ...createEmptyUsageSnapshot(), source: 'local' }, receipts: {} }
    const value = JSON.parse(raw)
    if (!value?.snapshot || !value.receipts || typeof value.receipts !== 'object' || Array.isArray(value.receipts)) throw new Error('개인 대전 집계가 손상됐습니다. 기록을 보존했습니다.')
    for (const key of Object.keys(createEmptyUsageSnapshot().buckets)) assertUsageBucket(value.snapshot.buckets?.[key])
    return value
  }
  return {
    read: () => read().snapshot,
    record(report, mode = 'ai') {
      if (typeof report?.battleId !== 'string' || !report.battleId || report.battleId.length > 200) throw new Error('대전 기록의 ID가 올바르지 않습니다.')
      const size = getRankedFormat(report.format)?.battleSize
      if (!size || !Array.isArray(report.speciesIds) || report.speciesIds.length !== size) throw new Error('싱글은 선출한 3마리, 더블은 선출한 4마리만 집계합니다.')
      const value = read()
      const receipt = `${mode}:${report.battleId}`
      if (Object.hasOwn(value.receipts, receipt)) return value.snapshot
      const team = report.team ?? report.speciesIds
      if (!Array.isArray(team) || team.length !== size || team.some((member, index) => (typeof member === 'object' ? member.speciesId : member) !== report.speciesIds[index])) throw new Error('출전팀과 집계 기록이 일치하지 않습니다.')
      const key = usageBucketKey(mode, report.format)
      const buckets = { ...value.snapshot.buckets, [key]: recordUsageTeams(value.snapshot.buckets[key], [team]) }
      const snapshot = { buckets, source: 'local', updatedAt: buckets[key].updatedAt }
      storage.setItem(LOCAL_USAGE_KEY, JSON.stringify({ snapshot, receipts: { ...value.receipts, [receipt]: true } }))
      return snapshot
    },
  }
}
