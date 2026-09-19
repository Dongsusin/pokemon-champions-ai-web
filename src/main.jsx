import { isGameFrame, mountGameViewport } from './fixedGameViewport.js'

// Only the game document starts React, authentication and resource loading.
// A real viewport keeps CSS viewport units, portals and pointer coordinates
// consistent while the host scales the complete screen without cropping it.
async function start() {
  if (isGameFrame()) {
    document.documentElement.dataset.gameFrame = 'true'
    await import('./gameEntry.jsx')
  } else {
    await import('./fixedGameViewport.css')
    mountGameViewport(document.getElementById('root'))
  }
}
start()
