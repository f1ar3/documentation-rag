import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function loadDemo() {
  // Dev-only: `?demo=1` renders mock messages without a backend. The branch is
  // removed from production builds because import.meta.env.DEV is statically false.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
    const { demoDocuments, demoMessages } = await import('./dev/demo')
    return { documents: demoDocuments, messages: demoMessages }
  }
  return undefined
}

void loadDemo().then((demo) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App demo={demo} />
    </StrictMode>,
  )
})
