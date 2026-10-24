import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CircleAlert, ExternalLink, FileText } from 'lucide-react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, buttonVariants } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ApiError, documentFileUrl } from '@/lib/api'
import { sameSource } from '@/lib/citations'
import { reflowPdfText } from '@/lib/reflow'
import type { DocumentContent, DocumentPart, Source } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { ViewerRequest } from '@/state/viewer'
import { uniqueSources } from './sources'

const HIGHLIGHT_MS = 1500
const LOAD_ERROR = 'Не удалось открыть документ'

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  md: 'Markdown',
  txt: 'TXT',
}

function formatLabel(name: string, content: DocumentContent | null): string {
  const format = content?.format ?? name.split('.').pop()?.toLowerCase() ?? ''
  return FORMAT_LABELS[format] ?? format.toUpperCase()
}

function tocLabel(part: DocumentPart): string {
  if (part.page !== null) return `Стр. ${part.page}`
  return part.section ?? 'Начало'
}

function refLabel(src: Source): string {
  if (src.page !== null) return `стр. ${src.page}`
  return `«${src.section}»`
}

/** Index of the part a citation points to: the page for PDF, the section for DOCX/MD; -1 if none. */
function findPart(parts: DocumentPart[], target: Source | null): number {
  if (!target) return -1
  if (target.page !== null) return parts.findIndex((p) => p.page === target.page)
  if (target.section !== null) return parts.findIndex((p) => p.section === target.section)
  return -1
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const markdownComponents: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
}
const remarkPlugins = [remarkGfm]

/** Result of one load; `key` tells which open (or retry) it belongs to. */
type LoadState = { key: string; name: string; content: DocumentContent | null; error: string | null }

function Part({
  part,
  index,
  format,
  register,
}: {
  part: DocumentPart
  index: number
  format: DocumentContent['format']
  register(index: number, el: HTMLElement | null): void
}) {
  const headingId = useId()
  const title = part.page !== null ? `Страница ${part.page}` : part.section
  return (
    <section
      ref={(el) => register(index, el)}
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : format === 'txt' ? 'Текст' : 'Начало'}
      className={cn(
        // data-highlighted is toggled by the viewer for a moment after a jump to this part.
        '-mx-3 scroll-mt-3 rounded-xl px-3 py-3 transition-colors duration-700 ease-out motion-reduce:transition-none data-highlighted:bg-brand-soft data-highlighted:duration-150',
      )}
    >
      {part.page !== null && (
        <h3 id={headingId} className="mb-2 text-xs font-medium text-muted-foreground">
          {title}
        </h3>
      )}
      {part.page === null && part.section && (
        <h3 id={headingId} className="mb-2 text-base leading-snug font-semibold text-foreground">
          {title}
        </h3>
      )}
      {format === 'md' ? (
        <div className="markdown">
          <Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>
            {part.text}
          </Markdown>
        </div>
      ) : (
        <p className="leading-7 break-words whitespace-pre-wrap">
          {format === 'pdf' ? reflowPdfText(part.text) : part.text}
        </p>
      )}
    </section>
  )
}

function Skeleton() {
  return (
    <div role="status" aria-label="Загрузка документа" className="space-y-3 py-3">
      {['w-1/3', 'w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-1/4', 'w-full', 'w-10/12'].map((w, i) => (
        <div
          key={i}
          className={cn('h-4 animate-pulse rounded bg-muted motion-reduce:animate-none', w, i === 5 && 'mt-7')}
        />
      ))}
    </div>
  )
}

export function DocumentViewer({
  request,
  load,
  onSelect,
  onClose,
}: {
  request: ViewerRequest | null
  load(name: string): Promise<DocumentContent>
  onSelect(target: Source): void
  onClose(): void
}) {
  // Keep the last request so the sheet does not slide out empty during its close animation
  // (state adjusted during render, same idea as the delete dialog in Documents).
  const [shown, setShown] = useState<ViewerRequest | null>(request)
  if (request !== null && request !== shown) setShown(request)

  const [state, setState] = useState<LoadState>({ key: '', name: '', content: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const partRefs = useRef<(HTMLElement | null)[]>([])
  // Focus lands on the text, not on the first link: arrow keys and Page Down scroll it right away.
  const bodyRef = useRef<HTMLDivElement>(null)

  const name = request?.name
  const key = request ? `${request.name}#${request.openId}#${attempt}` : null
  useEffect(() => {
    if (name === undefined || key === null) return
    let cancelled = false
    load(name).then(
      (content) => {
        if (!cancelled) setState({ key, name, content, error: null })
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({ key, name, content: null, error: err instanceof ApiError ? err.message : LOAD_ERROR })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [name, key, load])

  // While a load is in flight the last text of the same document stays on screen (reopening it
  // does not flash the skeleton); a previous error is hidden. A closing sheet keeps what it had.
  const sameDocument = shown !== null && state.name === shown.name
  const loading = key !== null && state.key !== key
  const content = sameDocument ? state.content : null
  const error = sameDocument && !loading ? state.error : null

  const register = useCallback((index: number, el: HTMLElement | null) => {
    partRefs.current[index] = el
  }, [])

  const scrollToPart = useCallback((index: number) => {
    partRefs.current[index]?.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [])

  const target = request?.target ?? null
  const focusId = request?.focusId
  useEffect(() => {
    if (!content || focusId === undefined) return
    const index = findPart(content.parts, target)
    // A citation to a part that is not in the document any more: stay at the top, no error.
    if (index < 0) return
    scrollToPart(index)
    const el = partRefs.current[index]
    el?.setAttribute('data-highlighted', '')
    const timer = window.setTimeout(() => el?.removeAttribute('data-highlighted'), HIGHLIGHT_MS)
    return () => {
      window.clearTimeout(timer)
      el?.removeAttribute('data-highlighted')
    }
  }, [content, focusId, target, scrollToPart])

  const refs = shown
    ? uniqueSources(shown.refs).filter(
        (s) => s.source === shown.name && (s.page !== null || s.section !== null),
      )
    : []
  const showToc = content !== null && content.format !== 'txt' && content.parts.length > 1
  const pagesToc = content?.format === 'pdf'

  return (
    <Sheet open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" initialFocus={bodyRef} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {shown && (
          <>
            <SheetHeader className="shrink-0 gap-0 border-b px-5 pt-5 pb-4 sm:px-8">
              <div className="flex items-start gap-3 pr-10">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <FileText className="size-[18px]" aria-hidden />
                </span>
                <div className="min-w-0">
                  <SheetTitle className="text-base leading-snug font-semibold [overflow-wrap:anywhere]">
                    {shown.name}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5">{formatLabel(shown.name, content)}</SheetDescription>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <a
                  href={documentFileUrl(shown.name)}
                  target="_blank"
                  rel="noopener"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-coarse:h-9')}
                >
                  <ExternalLink aria-hidden />
                  Открыть оригинал
                </a>
                {refs.length > 0 && (
                  <div
                    role="group"
                    aria-label="Ссылки ответа на этот файл"
                    className="flex min-w-0 flex-wrap items-center gap-1.5"
                  >
                    <span className="text-xs text-muted-foreground" aria-hidden>
                      В ответе:
                    </span>
                    {refs.map((ref) => {
                      const active = shown.target !== null && sameSource(ref, shown.target)
                      return (
                        <button
                          key={refLabel(ref)}
                          type="button"
                          aria-current={active ? 'true' : undefined}
                          onClick={() => onSelect(ref)}
                          className={cn(
                            'max-w-full truncate rounded-md px-2 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:py-1.5',
                            active
                              ? 'bg-brand-soft text-brand-text'
                              : 'bg-muted text-foreground hover:bg-brand-soft hover:text-brand-text',
                          )}
                        >
                          {refLabel(ref)}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </SheetHeader>

            <div ref={bodyRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none">
              <div className="px-5 pt-4 pb-10 text-[15px] text-foreground sm:px-8">
                {error && (
                  <div
                    role="alert"
                    className="mt-2 flex flex-col items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                  >
                    <div className="flex items-start gap-2">
                      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>{error}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                      Повторить
                    </Button>
                  </div>
                )}
                {!error && !content && <Skeleton />}
                {content && (
                  <>
                    {showToc && (
                      <nav aria-label="Оглавление" className="border-b pt-2 pb-5">
                        <h3 className="mb-2 text-xs font-medium text-muted-foreground">Содержание</h3>
                        <ul className={cn(pagesToc ? 'flex flex-wrap gap-1.5' : 'flex flex-col')}>
                          {content.parts.map((part, i) => (
                            <li key={i}>
                              <button
                                type="button"
                                onClick={() => scrollToPart(i)}
                                className={cn(
                                  'text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                  pagesToc
                                    ? 'rounded-md bg-muted px-2.5 py-1 text-xs tabular-nums hover:bg-brand-soft hover:text-brand-text pointer-coarse:py-2'
                                    : '-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-muted pointer-coarse:py-2.5',
                                )}
                              >
                                {tocLabel(part)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </nav>
                    )}
                    <div className={cn('flex flex-col gap-2', showToc && 'mt-3')}>
                      {content.parts.map((part, i) => (
                        <Part
                          key={i}
                          part={part}
                          index={i}
                          format={content.format}
                          register={register}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
