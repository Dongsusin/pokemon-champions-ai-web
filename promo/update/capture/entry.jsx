// Isolated filming entry: production UI, local owned parties and local auth only.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { GameApp } from '../../../src/App'
import { acquireAccountSession } from '../../../src/auth/accountSession'
import '../../../src/mobileViewport'
import '../../../src/styles.css'
import '../../../src/screenRedesign.css'
import '../../../src/battleGen5.css'
import '../../../src/titleCleanup.css'
import '../../../src/battleGimmicks.css'
import '../../../src/moveAnimationDirector.css'
import '../../../src/settings.css'
import '../../../src/auth.css'
import '../../../src/mobileLandscape.css'

if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw Error('Capture entry is local only')
// The guest lease establishes the real wallet's local ownership contract without
// creating a Firestore account lease. The UI identity remains authenticated to
// the isolated development HTTP server through its supplied token.
await acquireAccountSession({ uid: window.__captureUser.uid, isLocalGuest: true })
createRoot(document.getElementById('root')).render(<GameApp user={window.__captureUser} />)
