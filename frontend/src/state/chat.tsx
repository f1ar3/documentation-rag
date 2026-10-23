import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { ApiError, getHistory, streamChat } from '@/lib/api'
import { getThreadId, newThreadId, setThreadId } from '@/lib/thread'
import { loadThreads, removeThread, touchThread } from '@/lib/threads'
import type { ThreadInfo } from '@/lib/threads'
import type { ChatMessage, Source } from '@/lib/types'

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error' | 'stopped'

export type UiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: Source[]
  /** pending = waiting for the first token ("Ищу в документах...") */
  status: MessageStatus
  error?: string
  /** created in this session: gets the appear animation (history does not) */
  fresh?: boolean
}

type ChatState = {
  threadId: string
  threads: ThreadInfo[]
  messages: UiMessage[]
  busy: boolean
  loadingHistory: boolean
  send(text: string): void
  stop(): void
  newChat(): void
  selectThread(id: string): void
  forgetThread(id: string): void
  reloadHistory(): void
}

const ChatContext = createContext<ChatState | null>(null)

let idSeq = 0
const nextId = () => `m${++idSeq}`

function fromHistory(messages: ChatMessage[]): UiMessage[] {
  return messages.map((m) => ({
    id: nextId(),
    role: m.role,
    content: m.content,
    sources: m.sources ?? [],
    status: 'done',
  }))
}

const scheduleFrame: (cb: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => window.setTimeout(cb, 16)
const cancelFrame: (id: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (id) => cancelAnimationFrame(id)
    : (id) => window.clearTimeout(id)

export function ChatProvider({
  children,
  initialMessages,
}: {
  children: ReactNode
  /** Skips the initial history fetch (used by the dev-only demo mode). */
  initialMessages?: UiMessage[]
}) {
  const [threadId, setThreadState] = useState(getThreadId)
  const [threads, setThreads] = useState(loadThreads)
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages ?? [])
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(!initialMessages)
  const threadRef = useRef(threadId)
  // Bumped by every history load, send and thread switch: a history response is applied only if
  // nothing happened since its request started (otherwise it would wipe a just-sent question).
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const loadHistory = useCallback((id: string) => {
    const generation = ++generationRef.current
    const isCurrent = () => generationRef.current === generation
    setLoadingHistory(true)
    getHistory(id)
      .then((history) => {
        if (!isCurrent()) return
        setMessages(fromHistory(history))
        const firstQuestion = history.find((m) => m.role === 'user')
        if (firstQuestion && !loadThreads().some((t) => t.id === id)) {
          setThreads(touchThread(id, firstQuestion.content))
        }
      })
      .catch((err: unknown) => {
        if (!isCurrent()) return
        // Server-side and network failures (e.g. 503 without an API key) are shown by the
        // connection banner; only client-side problems get a toast here.
        if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) return
        toast.error(
          `Не удалось загрузить историю чата: ${err instanceof Error ? err.message : 'ошибка'}`,
        )
      })
      .finally(() => {
        if (isCurrent()) setLoadingHistory(false)
      })
  }, [])

  useEffect(() => {
    if (initialMessages) return
    loadHistory(threadRef.current)
  }, [initialMessages, loadHistory])

  useEffect(() => () => abortRef.current?.abort(), [])

  const switchTo = useCallback((id: string) => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    threadRef.current = id
    setThreadState(id)
    setMessages([])
    setBusy(false)
  }, [])

  const send = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text || abortRef.current) return
    const thread = threadRef.current
    // A history request still in flight must not overwrite this exchange.
    generationRef.current += 1
    setLoadingHistory(false)
    setThreads(touchThread(thread, text))

    const assistantId = nextId()
    setMessages((list) => [
      ...list,
      { id: nextId(), role: 'user', content: text, sources: [], status: 'done', fresh: true },
      { id: assistantId, role: 'assistant', content: '', sources: [], status: 'pending', fresh: true },
    ])
    const patch = (fn: (m: UiMessage) => UiMessage) =>
      setMessages((list) => list.map((m) => (m.id === assistantId ? fn(m) : m)))

    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)

    let streamed = ''
    let frame = 0
    const flush = () => {
      frame = 0
      const content = streamed
      patch((m) => ({ ...m, content, status: m.status === 'pending' ? 'streaming' : m.status }))
    }
    const cancel = () => {
      if (frame) cancelFrame(frame)
      frame = 0
    }

    void streamChat(
      thread,
      text,
      {
        onToken(token) {
          streamed += token
          // Batch tokens into one render per animation frame.
          if (!frame) frame = scheduleFrame(flush)
        },
        onSources(sources, answer) {
          cancel()
          // The final answer from the server replaces the streamed text (it may drop bad labels).
          if (answer) streamed = answer
          const content = streamed
          patch((m) => ({ ...m, content, sources, status: 'streaming' }))
        },
        onError(message) {
          cancel()
          const content = streamed
          patch((m) => ({ ...m, content, status: 'error', error: message }))
        },
        onDone() {
          cancel()
          const content = streamed
          const aborted = controller.signal.aborted
          patch((m) =>
            m.status === 'error' ? m : { ...m, content, status: aborted ? 'stopped' : 'done' },
          )
          if (abortRef.current === controller) {
            abortRef.current = null
            setBusy(false)
          }
        },
      },
      controller.signal,
    )
  }, [])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const newChat = useCallback(() => {
    switchTo(newThreadId())
    setLoadingHistory(false)
  }, [switchTo])

  const selectThread = useCallback(
    (id: string) => {
      if (id === threadRef.current) return
      setThreadId(id)
      switchTo(id)
      loadHistory(id)
    },
    [switchTo, loadHistory],
  )

  const forgetThread = useCallback(
    (id: string) => {
      setThreads(removeThread(id))
      if (id === threadRef.current) newChat()
    },
    [newChat],
  )

  const reloadHistory = useCallback(() => {
    if (!abortRef.current) loadHistory(threadRef.current)
  }, [loadHistory])

  const value = useMemo(
    () => ({
      threadId,
      threads,
      messages,
      busy,
      loadingHistory,
      send,
      stop,
      newChat,
      selectThread,
      forgetThread,
      reloadHistory,
    }),
    [threadId, threads, messages, busy, loadingHistory, send, stop, newChat, selectThread, forgetThread, reloadHistory],
  )
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used inside ChatProvider')
  return ctx
}
