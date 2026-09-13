const environment = import.meta.env ?? {}
export const gameStorageProvider = environment.VITE_GAME_STORAGE_PROVIDER === 'supabase' ? 'supabase' : 'firestore'
export const isServerGameStorage = gameStorageProvider === 'supabase'
const pageUrl = typeof window === 'undefined' ? 'http://localhost/' : window.location.href
export const accountApiUrl = new URL(environment.VITE_ACCOUNT_API_URL || '/api/account', pageUrl).href
