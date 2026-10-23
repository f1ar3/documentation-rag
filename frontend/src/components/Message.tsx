import { memo, useCallback } from 'react'
import { CircleAlert, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sourceLabel } from '@/lib/citations'
import type { Source } from '@/lib/types'
import type { UiMessage } from '@/state/chat'
import { AnswerMarkdown } from './AnswerMarkdown'
import { uniqueSources } from './sources'

export type OpenSource = (messageId: string, source: Source) => void

const appear =
  'animate-in fade-in-0 slide-in-from-bottom-1 duration-150 ease-out motion-reduce:animate-none'

function SourcesList({ sources, onOpen }: { sources: Source[]; onOpen(source: Source): void }) {
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Источники</h3>
      <ul className="flex flex-wrap gap-1.5" aria-label="Источники">
        {sources.map((src) => (
          <li key={sourceLabel(src)} className="max-w-full">
            <button
              type="button"
              onClick={() => onOpen(src)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{sourceLabel(src)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AssistantMessage({ message, onOpenSource }: { message: UiMessage; onOpenSource: OpenSource }) {
  const { id, content, status, error } = message
  const streaming = status === 'pending' || status === 'streaming'
  const open = useCallback((src: Source) => onOpenSource(id, src), [id, onOpenSource])
  const sources = uniqueSources(message.sources)

  return (
    <div className={cn('min-h-7 text-[15px] text-foreground sm:text-base', message.fresh && appear)}>
      {status === 'pending' && (
        <p className="status-pulse leading-7 text-muted-foreground" role="status">
          Ищу в документах...
        </p>
      )}
      {content && (
        <AnswerMarkdown
          content={content}
          sources={message.sources}
          streaming={streaming}
          onOpenSource={open}
        />
      )}
      {status === 'error' && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive',
            content && 'mt-3',
          )}
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}
      {status === 'stopped' && (
        <p className={cn('text-sm text-muted-foreground', content && 'mt-2')}>
          Генерация остановлена
        </p>
      )}
      {sources.length > 0 && <SourcesList sources={sources} onOpen={open} />}
    </div>
  )
}

/** Memoized: while a reply streams only its own item re-renders. */
export const MessageItem = memo(function MessageItem({
  message,
  onOpenSource,
}: {
  message: UiMessage
  onOpenSource: OpenSource
}) {
  if (message.role === 'user') {
    return (
      <div className={cn('flex justify-end', message.fresh && appear)}>
        <div className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap sm:text-base">
          {message.content}
        </div>
      </div>
    )
  }
  return <AssistantMessage message={message} onOpenSource={onOpenSource} />
})
