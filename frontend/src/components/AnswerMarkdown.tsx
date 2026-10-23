import { Children, createContext, memo, useContext, useMemo } from 'react'
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import Markdown from 'react-markdown'
import type { Components, ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { sameSource, sourceLabel, splitCitations } from '@/lib/citations'
import type { Source } from '@/lib/types'

type CitationContextValue = {
  sources: Source[]
  /** Labels are still arriving and the server has not confirmed sources yet. */
  provisional: boolean
  onOpenSource(source: Source): void
}

const CitationContext = createContext<CitationContextValue>({
  sources: [],
  provisional: false,
  onOpenSource: () => {},
})

function rawLabel(src: Source): string {
  if (src.page !== null) return `[${src.source}, стр. ${src.page}]`
  if (src.section !== null) return `[${src.source}, раздел "${src.section}"]`
  return `[${src.source}]`
}

export function CitationChip({
  source,
  onOpen,
  className,
}: {
  source: Source
  onOpen(source: Source): void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(source)}
      title="Открыть источник"
      className={cn(
        'mx-0.5 inline-flex max-w-full items-center rounded-md bg-brand-soft px-1.5 py-px align-baseline text-[0.8em] leading-normal font-medium text-brand-text transition-colors hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <span className="truncate">{sourceLabel(source)}</span>
    </button>
  )
}

function withCitations(children: ReactNode, ctx: CitationContextValue): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== 'string') return child
    const parts = splitCitations(child)
    if (parts.every((p) => p.type === 'text')) return child
    return parts.map((part, i) => {
      if (part.type === 'text') return part.value
      const src: Source = { source: part.source, page: part.page, section: part.section }
      if (ctx.sources.some((s) => sameSource(s, src))) {
        return <CitationChip key={i} source={src} onOpen={ctx.onOpenSource} />
      }
      if (ctx.provisional) {
        // Same footprint as a chip, so confirming it later does not shift the text.
        return (
          <span
            key={i}
            className="mx-0.5 inline-flex max-w-full items-center rounded-md bg-muted px-1.5 py-px align-baseline text-[0.8em] leading-normal font-medium text-muted-foreground"
          >
            <span className="truncate">{sourceLabel(src)}</span>
          </span>
        )
      }
      // Labels the server did not confirm are shown as plain text.
      return rawLabel(src)
    })
  })
}

function withCitationsComponent<T extends ElementType>(Tag: T) {
  function Wrapped({ node: _node, children, ...props }: ComponentPropsWithoutRef<T> & ExtraProps) {
    const ctx = useContext(CitationContext)
    const Element = Tag as ElementType
    return <Element {...props}>{withCitations(children as ReactNode, ctx)}</Element>
  }
  return Wrapped
}

const components: Components = {
  p: withCitationsComponent('p'),
  li: withCitationsComponent('li'),
  td: withCitationsComponent('td'),
  th: withCitationsComponent('th'),
  strong: withCitationsComponent('strong'),
  em: withCitationsComponent('em'),
  del: withCitationsComponent('del'),
  h1: withCitationsComponent('h1'),
  h2: withCitationsComponent('h2'),
  h3: withCitationsComponent('h3'),
  h4: withCitationsComponent('h4'),
  h5: withCitationsComponent('h5'),
  h6: withCitationsComponent('h6'),
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
}

const remarkPlugins = [remarkGfm]

export const AnswerMarkdown = memo(function AnswerMarkdown({
  content,
  sources,
  streaming,
  onOpenSource,
}: {
  content: string
  sources: Source[]
  streaming: boolean
  onOpenSource(source: Source): void
}) {
  const ctx = useMemo(
    () => ({ sources, provisional: streaming && sources.length === 0, onOpenSource }),
    [sources, streaming, onOpenSource],
  )
  return (
    <CitationContext.Provider value={ctx}>
      <div className={cn('markdown', streaming && 'is-streaming')}>
        <Markdown remarkPlugins={remarkPlugins} components={components}>
          {content}
        </Markdown>
      </div>
    </CitationContext.Provider>
  )
})
