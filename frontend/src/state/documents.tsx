import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { ApiError, deleteDocument, listDocuments, uploadDocuments } from '@/lib/api'
import { isAccepted } from '@/lib/files'
import type { DocumentInfo } from '@/lib/types'

export type PendingUpload = { id: number; name: string }

type DocumentsState = {
  /** null while the first load is in flight */
  documents: DocumentInfo[] | null
  uploads: PendingUpload[]
  loadError: ApiError | null
  reload(): void
  upload(files: File[]): Promise<void>
  remove(name: string): Promise<boolean>
}

const DocumentsContext = createContext<DocumentsState | null>(null)

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function merge(list: DocumentInfo[], doc: DocumentInfo): DocumentInfo[] {
  const rest = list.filter((d) => d.name !== doc.name)
  return [...rest, doc].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export function DocumentsProvider({
  children,
  initialDocuments,
}: {
  children: ReactNode
  /** Skips the initial fetch (used by the dev-only demo mode). */
  initialDocuments?: DocumentInfo[]
}) {
  const [documents, setDocuments] = useState<DocumentInfo[] | null>(initialDocuments ?? null)
  const [uploads, setUploads] = useState<PendingUpload[]>([])
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const uploadSeq = useRef(0)
  const loadSeq = useRef(0)

  const reload = useCallback(() => {
    const seq = ++loadSeq.current
    listDocuments()
      .then((docs) => {
        if (seq !== loadSeq.current) return
        setDocuments(docs)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== loadSeq.current) return
        setDocuments((prev) => prev ?? [])
        setLoadError(
          err instanceof ApiError ? err : new ApiError(0, 'Не удалось загрузить список документов'),
        )
      })
  }, [])

  useEffect(() => {
    if (initialDocuments) return
    reload()
  }, [initialDocuments, reload])

  const upload = useCallback(async (files: File[]) => {
    const accepted = files.filter(isAccepted)
    const rejected = files.filter((f) => !isAccepted(f))
    if (rejected.length > 0) {
      const names = rejected.map((f) => f.name).join(', ')
      toast.error(`Формат не поддерживается: ${names}. Можно загружать PDF, DOCX, MD и TXT.`)
    }
    if (accepted.length === 0) return

    const pending = accepted.map((file) => ({ id: ++uploadSeq.current, name: file.name, file }))
    setUploads((prev) => [...prev, ...pending.map(({ id, name }) => ({ id, name }))])

    // One request per file: each file gets its own progress row and its own error message.
    // A toast per file keeps the progress visible when the sidebar is closed or collapsed.
    for (const item of pending) {
      const toastId = toast.loading(`Загружаю ${item.name}...`)
      try {
        const result = await uploadDocuments([item.file])
        setDocuments((prev) => result.reduce(merge, prev ?? []))
        setLoadError(null)
        toast.success(`Документ «${item.name}» загружен`, { id: toastId })
      } catch (err) {
        toast.error(errorText(err, `Не удалось загрузить ${item.name}`), { id: toastId })
      } finally {
        setUploads((prev) => prev.filter((u) => u.id !== item.id))
      }
    }
  }, [])

  const remove = useCallback(async (name: string) => {
    try {
      await deleteDocument(name)
      setDocuments((prev) => (prev ?? []).filter((d) => d.name !== name))
      toast.success(`Документ «${name}» удалён`)
      return true
    } catch (err) {
      toast.error(errorText(err, `Не удалось удалить ${name}`))
      return false
    }
  }, [])

  const value = useMemo(
    () => ({ documents, uploads, loadError, reload, upload, remove }),
    [documents, uploads, loadError, reload, upload, remove],
  )
  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>
}

export function useDocuments(): DocumentsState {
  const ctx = useContext(DocumentsContext)
  if (!ctx) throw new Error('useDocuments must be used inside DocumentsProvider')
  return ctx
}

/** For components that also render without documents (e.g. the composer in tests). */
export function useOptionalDocuments(): DocumentsState | null {
  return useContext(DocumentsContext)
}
