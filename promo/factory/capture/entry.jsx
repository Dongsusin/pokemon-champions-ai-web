// Local filming entry. Uses the shipped UI; no cloud account or production API.
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

if (!import.meta.env.DEV || location.hostname !== '127.0.0.1') throw Error('Local capture only')
await acquireAccountSession({ uid: window.__captureUser.uid, isLocalGuest: true })
createRoot(document.getElementById('root')).render(<GameApp user={window.__captureUser} />)
