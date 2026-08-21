import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './screenRedesign.css'
import './battleGen5.css'
import './titleCleanup.css'
import './battleGimmicks.css'
import './moveAnimationDirector.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
