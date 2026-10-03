// Existing saves can still contain the old absolute sprite addresses. Resolve
// those addresses to installed files without fetching the original websites.
export const ASSET_SOURCES = Object.freeze([
  ['https://play.pokemonshowdown.com/sprites/', '/assets/vendor/showdown/'],
  ['https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/', '/assets/vendor/pokeapi/'],
  ['https://raw.githubusercontent.com/PokeAPI/cries/main/cries/', '/assets/vendor/cries/'],
])
export function localAssetUrl(source) {
  if (typeof source !== 'string') return source
  for (const [remote, local] of ASSET_SOURCES) if (source.startsWith(remote)) return local + source.slice(remote.length).split('?')[0]
  if (/^https?:\/\//i.test(source)) return null
  return source
}
export function assetDownloadUrl(source) {
  for (const [remote, local] of ASSET_SOURCES) if (source.startsWith(local)) return remote + source.slice(local.length)
  return source
}
