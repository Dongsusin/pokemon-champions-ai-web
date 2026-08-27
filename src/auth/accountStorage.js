const PLAYER_STORAGE_KEYS = [
  'champions-dex-v2',
  'champions-box-v1',
  'champions-teams-v1',
  'champions-team-v2',
  'champions-team-v1',
  'champions-vp-v1',
  'champions-battle-items-v1',
  'champions-draw-tutorial-v1',
  'champions-settings-v1',
]

export function clearLocalPlayerData() {
  if (typeof window === 'undefined') return

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of PLAYER_STORAGE_KEYS) {
      try {
        storage.removeItem(key)
      } catch {}
    }
  }
}
