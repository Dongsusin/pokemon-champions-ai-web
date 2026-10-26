const environment = import.meta.env ?? {}
export const gameStorageProvider = ['supabase', 'cloudflare'].includes(environment.VITE_GAME_STORAGE_PROVIDER) ? environment.VITE_GAME_STORAGE_PROVIDER : 'firestore'
export const isServerGameStorage = ['supabase', 'cloudflare'].includes(gameStorageProvider)
const pageUrl = typeof window === 'undefined' ? 'http://localhost/' : window.location.href
export const accountApiUrl = new URL(environment.VITE_ACCOUNT_API_URL || '/api/account', pageUrl).href
