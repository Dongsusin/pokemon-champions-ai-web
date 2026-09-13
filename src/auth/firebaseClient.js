import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { isServerGameStorage } from './gameStorageConfig.js'

const environment = import.meta.env ?? {}
const firebaseConfig = {
  apiKey: environment.VITE_FIREBASE_API_KEY,
  authDomain: environment.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: environment.VITE_FIREBASE_PROJECT_ID,
  storageBucket: environment.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: environment.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: environment.VITE_FIREBASE_APP_ID,
}

const requiredConfiguration = [
  ['VITE_FIREBASE_API_KEY', firebaseConfig.apiKey],
  ['VITE_FIREBASE_AUTH_DOMAIN', firebaseConfig.authDomain],
  ['VITE_FIREBASE_PROJECT_ID', firebaseConfig.projectId],
  ['VITE_FIREBASE_APP_ID', firebaseConfig.appId],
]

export const missingFirebaseEnvironmentVariables = requiredConfiguration
  .filter(([, value]) => !value)
  .map(([name]) => name)

export const isFirebaseConfigured = missingFirebaseEnvironmentVariables.length === 0

const firebaseApp = isFirebaseConfigured
  ? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig))
  : null

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firebaseDb = firebaseApp && !isServerGameStorage ? getFirestore(firebaseApp) : null
