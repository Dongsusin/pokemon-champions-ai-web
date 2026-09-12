import './mobileViewport'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App, { RankedTestApp } from './App'
import { isRankedLocalTest } from './rankedClient'
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ResourceBootstrap>
      {isRankedLocalTest ? <RankedTestApp /> : <AuthProvider>
        <App />
      </AuthProvider>}
    </ResourceBootstrap>
  </StrictMode>,
)
