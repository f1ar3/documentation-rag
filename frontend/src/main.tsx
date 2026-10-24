import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

async function loadDemo() {
  // Dev-only: `?demo=1` renders mock messages without a backend. The branch is
  // removed from production builds because import.meta.env.DEV is statically false.
  const params = new URLSearchParams(window.location.search)
  if (import.meta.env.DEV && params.has('demo')) {
    const { demoDocuments, demoMessages, loadDemoDocument } = await import('./dev/demo')
    // `&doc=otpuska.pdf&page=2` (or `&section=...`) opens the viewer as a citation chip would.
    const doc = params.get('doc')
    const page = params.get('page')
    const target = doc
      ? { source: doc, page: page ? Number(page) : null, section: params.get('section') }
      : null
    const refs = demoMessages.flatMap((m) => m.sources)
    return {
      documents: demoDocuments,
      messages: demoMessages,
      loadDocument: loadDemoDocument,
      view: doc ? { name: doc, target, refs: target && (target.page !== null || target.section !== null) ? refs : [] } : undefined,
    }
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
