import { createFirestoreRankedStore } from './rankedStore.js'
import { createGuestIdentityRegistry, rankedIdentityFromVerifiedToken } from './guestIdentity.js'
import { readTrainerNickname } from '../src/data/trainerNickname.js'
import { readTrainerTitle } from '../src/data/titleData.js'
import { containsChatProfanity } from './chatModeration.js'

export const NICKNAME_CACHE_MS = 15_000
const NICKNAME_CACHE_MAX_ENTRIES = 2000

// One profile read serves both public labels: the nickname and the title shown
// beside it in chat.
export function createVerifiedNicknameReader({ accountStore, now = Date.now }) {
  const cache = new Map()
  const empty = { nickname: '', title: '' }
  return async (uid, { fresh = false } = {}) => {
    if (!accountStore) return empty
    const previous = cache.get(uid)
    if (!fresh && previous?.expiresAt > now()) return previous.labels
    if (!fresh && previous?.pending) return previous.pending
    // Forced reads start a new transaction rather than joining an older lookup
    // that may have started before the user's nickname update committed.
    const entry = { expiresAt: 0, pending: null }
    if (cache.size >= NICKNAME_CACHE_MAX_ENTRIES && !cache.has(uid)) {
      for (const [key, value] of cache) if (!value.pending && value.expiresAt <= now()) cache.delete(key)
      if (cache.size >= NICKNAME_CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value)
    }
    cache.set(uid, entry)
    entry.pending = accountStore.transaction(tx => tx.get('profiles', uid)).then(profile => {
      const normalized = readTrainerNickname(profile?.nickname)
      const labels = {
        nickname: containsChatProfanity(normalized) ? '' : normalized,
        title: readTrainerTitle(profile?.title),
      }
      if (cache.get(uid) === entry) {
        entry.labels = labels
        entry.expiresAt = now() + NICKNAME_CACHE_MS
        entry.pending = null
      }
      return labels
    }).catch(error => { if (cache.get(uid) === entry) cache.delete(uid); throw error })
    return entry.pending
  }
}

async function startupModule(step, promise) {
  try { return await promise } catch (error) { error.rankedStartupStep = step; throw error }
}
const configurationError = () => Object.assign(new Error('Game storage configuration is incomplete'), { code: 'ranked/configuration-incomplete' })

// Vercel traces literal imports when it packages a function. A variable import
// can work locally while omitting the Firebase SDK or SQL adapter in production.
// Keep provider modules lazy while making every deployable dependency explicit.
const productionModules = {
  'firebase-admin/app': () => import('firebase-admin/app'),
  'firebase-admin/auth': () => import('firebase-admin/auth'),
  'firebase-admin/firestore': () => import('firebase-admin/firestore'),
  './postgresStore.js': () => import('./postgresStore.js'),
}
async function loadProductionModule(specifier) {
  if (!Object.hasOwn(productionModules, specifier)) throw Object.assign(new Error('Unsupported production module'), { code: 'MODULE_NOT_FOUND' })
  return productionModules[specifier]()
}

export async function initializeProductionServices({ env = process.env, loadModule = loadProductionModule, now = Date.now } = {}) {
  const provider = env.GAME_STORAGE_PROVIDER || 'firestore'
  if (!['firestore', 'supabase'].includes(provider) || !env.RANKED_FIREBASE_PROJECT_ID
    || (provider === 'firestore' && !env.RANKED_FIRESTORE_PREFIX)
    || (provider === 'supabase' && !env.DATABASE_URL)) throw configurationError()
  const [{ initializeApp, getApps, applicationDefault, cert }, { getAuth }] = await Promise.all([
    startupModule('firebase-app', loadModule('firebase-admin/app')),
    startupModule('firebase-auth', loadModule('firebase-admin/auth')),
  ])
  const options = { projectId: env.RANKED_FIREBASE_PROJECT_ID }
  if (env.RANKED_FIREBASE_SERVICE_ACCOUNT_JSON) {
    let credential
    try { credential = JSON.parse(env.RANKED_FIREBASE_SERVICE_ACCOUNT_JSON) }
    catch (error) { error.rankedStartupStep = 'credential-json'; throw error }
    if (credential.project_id !== options.projectId) throw Object.assign(new Error('Ranked service account project mismatch'), { code: 'ranked/project-mismatch' })
    options.credential = cert(credential)
  } else options.credential = applicationDefault()
  const app = getApps().find(candidate => candidate.name === 'ranked-server') ?? initializeApp(options, 'ranked-server')
  const auth = getAuth(app)
  let rankedStore, accountStore = null, firestore = null, pool = null
  if (provider === 'supabase') {
    const { createPostgresPool, createPostgresStore } = await startupModule('postgres-store', loadModule('./postgresStore.js'))
    pool = createPostgresPool({ connectionString: env.DATABASE_URL, sslCa: env.DATABASE_SSL_CA })
    rankedStore = createPostgresStore({ pool, namespace: env.RANKED_FIRESTORE_PREFIX || 'ranked' })
    accountStore = createPostgresStore({ pool, namespace: 'account' })
  } else {
    const { getFirestore } = await startupModule('firebase-firestore', loadModule('firebase-admin/firestore'))
    firestore = getFirestore(app)
    rankedStore = createFirestoreRankedStore(firestore, { prefix: env.RANKED_FIRESTORE_PREFIX })
  }
  const guestRegistry = createGuestIdentityRegistry({ store: rankedStore })
  const readNickname = createVerifiedNicknameReader({ accountStore, now })
  return {
    provider, rankedStore, accountStore, firestore, guestRegistry,
    async authenticate(request, token, { freshNickname = false } = {}) {
      const verified = await auth.verifyIdToken(token, true)
      const identity = rankedIdentityFromVerifiedToken(verified)
      const providerId = verified.firebase?.sign_in_provider
      // Account actions already read the canonical profile when needed. In
      // particular, lease heartbeats and autosaves must add no nickname query.
      let accountRequest = false
      try { accountRequest = new URL(request?.url).pathname === '/api/account' } catch { /* Direct service tests have no URL. */ }
      const labels = identity.isGuest || accountRequest
        ? { nickname: '', title: '' }
        : await readNickname(identity.uid, { fresh: freshNickname === true })
      return { ...identity, nickname: labels.nickname, title: labels.title, accountProfile: {
        email: verified.email ?? null, displayName: verified.name ?? null, photoURL: verified.picture ?? null,
        providerIds: typeof providerId === 'string' ? [providerId] : [],
      } }
    },
    async close() { if (pool) await pool.end() },
  }
}

let productionServices
export function getProductionServices() {
  if (!productionServices) productionServices = initializeProductionServices().catch(error => { productionServices = null; throw error })
  return productionServices
}
