// Storage values are strings. Compare them without parsing or re-encoding the
// entire collection; deletions must be explicit to preserve replace semantics.
export function createAccountSavePatch(previous, next) {
  const patch = Object.fromEntries(Object.entries(next).filter(([key, value]) => previous[key] !== value))
  const removed = Object.keys(previous).filter(key => !Object.hasOwn(next, key))
  return { patch, removed }
}
