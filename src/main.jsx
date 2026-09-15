import './mobileViewport'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App, { RankedTestApp } from './App'
import { isRankedLocalTest } from './rankedClient'
import { isPokemonUsageDemo } from './pokemonUsageClient'
import UsageTestApp from './UsageTestApp'
import { AuthProvider } from './auth/AuthProvider'
import ResourceBootstrap from './ResourceBootstrap'
import './styles.css'
import './screenRedesign.css'
import './battleGen5.css'
import './titleCleanup.css'
import './battleGimmicks.css'
import './moveAnimationDirector.css'
import './settings.css'
import './auth.css'
import './mobileLandscape.css'
import './gameTextScale.css'
import './scaledBoxCards.css'
import './scaledBattleCards.css'
import './scaledTrainingEditor.css'
import './mobileTouch.css'
import { loadGameSettings } from './gameSettings'
import { applyGameTextScale } from './gameTextScale'

applyGameTextScale(loadGameSettings().game.textScale)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ResourceBootstrap>
      {isPokemonUsageDemo ? <UsageTestApp /> : isRankedLocalTest ? <RankedTestApp /> : <AuthProvider>
        <App />
      </AuthProvider>}
    </ResourceBootstrap>
  </StrictMode>,
)
