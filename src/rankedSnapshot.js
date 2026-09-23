// A status poll still carries live metadata such as deadlines and submitted
// actions. Only immutable data for the same match revision may be reused.
export function knownMatchRevision(match) {
  return match?.id && Number.isSafeInteger(match.revision)
    && Object.hasOwn(match, 'state') && Object.hasOwn(match, 'teamPreview')
    ? match.revision : null
}

export function mergeRankedMatchSnapshot(previous, incoming) {
  if (!previous || !incoming || previous.id !== incoming.id) return incoming
  if (previous.revision > incoming.revision) return previous

  const sameRevision = previous.revision === incoming.revision
  const next = { ...incoming }
  if (sameRevision) {
    if (!Object.hasOwn(incoming, 'state') && Object.hasOwn(previous, 'state')) next.state = previous.state
    if (!Object.hasOwn(incoming, 'teamPreview') && Object.hasOwn(previous, 'teamPreview')) next.teamPreview = previous.teamPreview
  }
  if (previous.timelineRevision === incoming.timelineRevision
    && previous.timeline?.length && !incoming.timeline?.length) next.timeline = previous.timeline
  return next
}
