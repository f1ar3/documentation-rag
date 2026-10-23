import { useRef, useState } from 'react'
import { FileText, Loader2, Trash2, Upload } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ACCEPTED_EXTENSIONS } from '@/lib/files'
import { useDocuments } from '@/state/documents'
import { IconButton } from './IconButton'

function chunksLabel(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} фрагмент`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} фрагмента`
  return `${n} фрагментов`
}

export function Documents() {
  const { documents, uploads, upload, remove } = useDocuments()
  const fileRef = useRef<HTMLInputElement>(null)
  // The name outlives `confirmOpen` so the dialog text stays intact during its close animation.
  const [deleteName, setDeleteName] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const askDelete = (name: string) => {
    setDeleteName(name)
    setConfirmOpen(true)
  }

  const confirmDelete = async () => {
    setDeleting(true)
    await remove(deleteName)
    setDeleting(false)
    setConfirmOpen(false)
  }

  const count = documents?.length ?? 0
  const isEmpty = documents !== null && count === 0 && uploads.length === 0

  return (
    <section aria-labelledby="documents-heading" className="mt-6">
      <div className="flex h-8 items-center justify-between pr-1 pl-2">
        <h2 id="documents-heading" className="text-xs font-medium text-muted-foreground">
          Документы{count > 0 && <span className="ml-1.5 tabular-nums">{count}</span>}
        </h2>
        <IconButton
          label="Загрузить документы"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => fileRef.current?.click()}
        >
          <Upload aria-hidden />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(',')}
          aria-label="Выбрать файлы для загрузки"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length) void upload(files)
          }}
        />
      </div>

      {documents === null && (
        <div className="space-y-2 px-2 py-1.5" aria-label="Загрузка списка документов">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      )}

      {isEmpty && (
        <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          Документов пока нет. Перетащите файлы PDF, DOCX, MD или TXT в окно или нажмите кнопку
          загрузки.
        </p>
      )}

      <ul className="flex flex-col">
        {documents?.map((doc) => (
          <li
            key={doc.name}
            className="group flex items-center gap-2 rounded-lg py-1 pr-1 pl-2 transition-colors hover:bg-muted"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground" title={doc.name}>
                {doc.name}
              </div>
              <div className="text-xs text-muted-foreground">{chunksLabel(doc.chunks)}</div>
            </div>
            <IconButton
              label={`Удалить ${doc.name}`}
              side="right"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 aria-expanded:opacity-100"
              onClick={() => askDelete(doc.name)}
            >
              <Trash2 aria-hidden />
            </IconButton>
          </li>
        ))}
        {uploads.map((u) => (
          <li key={u.id} className="flex items-center gap-2 rounded-lg py-1 pr-1 pl-2" aria-live="polite">
            <Loader2
              className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">{u.name}</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Загрузка ${u.name}`}>
                <div className="progress-indeterminate h-full w-2/5 rounded-full bg-brand/70" />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirmOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить документ?</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteName}» будет удалён из базы. Бот перестанет опираться на него в ответах.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={confirmDelete}>
              {deleting && <Loader2 className="animate-spin" aria-hidden />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
