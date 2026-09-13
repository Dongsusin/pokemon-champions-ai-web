import { createFirestoreRankedStore } from './rankedStore.js'
import { createGuestIdentityRegistry, rankedIdentityFromVerifiedToken } from './guestIdentity.js'

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

export async function initializeProductionServices({ env = process.env, loadModule = loadProductionModule } = {}) {
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
  return {
    provider, rankedStore, accountStore, firestore, guestRegistry,
    async authenticate(_request, token) {
      const verified = await auth.verifyIdToken(token, true)
      const identity = rankedIdentityFromVerifiedToken(verified)
      const providerId = verified.firebase?.sign_in_provider
      return { ...identity, accountProfile: {
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
