import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// The component's own stylesheet. One import, not a framework -- and the only
// CSS the package needs, because FieldCanvas is SVG and needs none.
import '@agent-scope-ca/graph-canvas/styles.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
