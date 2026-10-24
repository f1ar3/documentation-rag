import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DocumentViewer } from '@/components/DocumentViewer'
import { getDocumentContent } from '@/lib/api'
import type { DocumentContent, Source } from '@/lib/types'

export type ViewerRequest = {
  name: string
  /** Place to scroll to (page for PDF, section for DOCX/MD); null opens at the top. */
  target: Source | null
  /** References of the answer the viewer was opened from (all files; the viewer keeps its own). */
  refs: Source[]
  /** Changes on every open: the content is loaded again. */
  openId: number
  /** Changes on every open and every jump to another reference: the viewer scrolls again. */
  focusId: number
}

export type OpenDocumentOptions = { target?: Source | null; refs?: Source[] }

type ViewerState = {
  open(name: string, options?: OpenDocumentOptions): void
}

const ViewerContext = createContext<ViewerState | null>(null)

// Components also render without the provider in unit tests; there opening is a no-op.
const noViewer: ViewerState = { open: () => {} }

export function ViewerProvider({
  children,
  load = getDocumentContent,
  initial,
}: {
  children: ReactNode
  /** Replaced by the dev-only demo mode, which has no backend. */
  load?: (name: string) => Promise<DocumentContent>
  /** Dev-only demo mode: the viewer is open from the start. */
  initial?: { name: string } & OpenDocumentOptions
}) {
  const seq = useRef(1)
  const [request, setRequest] = useState<ViewerRequest | null>(() =>
    initial
      ? { name: initial.name, target: initial.target ?? null, refs: initial.refs ?? [], openId: 1, focusId: 1 }
      : null,
  )

  const open = useCallback((name: string, options?: OpenDocumentOptions) => {
    const id = ++seq.current
    setRequest({
      name,
      target: options?.target ?? null,
      refs: options?.refs ?? [],
      openId: id,
      focusId: id,
    })
  }, [])

  const select = useCallback((target: Source) => {
    const id = ++seq.current
    setRequest((prev) => (prev ? { ...prev, target, focusId: id } : prev))
  }, [])

  const close = useCallback(() => setRequest(null), [])

  const value = useMemo(() => ({ open }), [open])
  return (
    <ViewerContext.Provider value={value}>
      {children}
      <DocumentViewer request={request} load={load} onSelect={select} onClose={close} />
    </ViewerContext.Provider>
  )
}

export function useDocumentViewer(): ViewerState {
  return useContext(ViewerContext) ?? noViewer
}
