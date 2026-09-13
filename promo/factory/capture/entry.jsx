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
// Decode and retain the same asset before filming so floor-to-floor remounts
// use a warm image cache instead of introducing a transient empty portrait.
const factoryTrainer = new Image()
factoryTrainer.src = '/assets/trainers/factory-clown-cutout.png'
await factoryTrainer.decode()
window.__factoryTrainerPreload = factoryTrainer
await acquireAccountSession({ uid: window.__captureUser.uid, isLocalGuest: true })
createRoot(document.getElementById('root')).render(<GameApp user={window.__captureUser} />)
