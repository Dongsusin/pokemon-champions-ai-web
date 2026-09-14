export function readRankedQueueCounts(value) {
  if (!value || !['single', 'double', 'total', 'updatedAt'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
    || value.total !== value.single + value.double) throw new Error('Invalid ranked queue counts')
  return { single: value.single, double: value.double, total: value.total, updatedAt: value.updatedAt }
}
