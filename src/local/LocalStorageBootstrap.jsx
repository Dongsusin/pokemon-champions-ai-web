import { useEffect, useState } from 'react'
import { AccountDataErrorScreen, AuthLoadingScreen } from '../LoginScreen.jsx'
import { initializeGameStorage } from './gameStorage.js'

export default function LocalStorageBootstrap({ children }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    initializeGameStorage().then(() => { if (active) setReady(true) }, failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [retry])
  if (ready) return children
  if (error) return <AccountDataErrorScreen message={error} onRetry={() => { setError(''); setRetry(value => value + 1) }} />
  return <AuthLoadingScreen />
}
