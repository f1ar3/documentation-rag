import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UiMessage } from '@/state/chat'
import { MessageItem } from './Message'
import type { OpenSource } from './Message'

/** Distance from the bottom (px) within which the list keeps following new content. */
const STICK_THRESHOLD = 80

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function MessageList({
  messages,
  busy,
  onOpenSource,
}: {
  messages: UiMessage[]
  busy: boolean
  onOpenSource: OpenSource
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' })
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
    stickRef.current = near
    setAtBottom(near)
  }, [])

  // A new question (or another chat) always brings the view to the bottom.
  const lastUserId = [...messages].reverse().find((m) => m.role === 'user')?.id
  const firstId = messages[0]?.id
  useLayoutEffect(() => {
    stickRef.current = true
    // No scroll event fires when the new content is already in view, so reset the flag here.
    // oxlint-disable-next-line react/set-state-in-effect
    setAtBottom(true)
    scrollToBottom()
  }, [lastUserId, firstId, scrollToBottom])

  // Follow streamed content only while the user stays near the bottom.
  useLayoutEffect(() => {
    if (stickRef.current) scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToBottom])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <div
          ref={contentRef}
          role="log"
          aria-busy={busy}
          aria-label="Переписка"
          className="mx-auto flex w-full max-w-[752px] flex-col gap-7 px-4 pt-6 pb-10"
        >
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} onOpenSource={onOpenSource} />
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-label="Прокрутить вниз"
        tabIndex={atBottom ? -1 : 0}
        onClick={() => {
          stickRef.current = true
          scrollToBottom(true)
        }}
        className={cn(
          'absolute bottom-3 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-foreground shadow-md transition-[opacity,translate] duration-150 ease-out hover:bg-muted pointer-coarse:size-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
          atBottom ? 'pointer-events-none translate-y-2 opacity-0' : 'opacity-100',
        )}
        aria-hidden={atBottom}
      >
        <ArrowDown className="size-4" aria-hidden />
      </button>
    </div>
  )
}
