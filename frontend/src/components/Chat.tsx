import { useCallback, useEffect, useRef } from 'react'
import type { Source } from '@/lib/types'
import { useChat } from '@/state/chat'
import { useDocumentViewer } from '@/state/viewer'
import { Composer } from './Composer'
import { EmptyState } from './EmptyState'
import { MessageList } from './MessageList'

/** Conversation pane: feed (or empty state) and composer. Citations open the document viewer. */
export function Chat() {
  const { messages, busy, loadingHistory, send } = useChat()
  const viewer = useDocumentViewer()

  // Read through a ref: a stable callback keeps memoized messages from re-rendering while a reply streams.
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const openSource = useCallback(
    (messageId: string, source: Source) => {
      const message = messagesRef.current.find((m) => m.id === messageId)
      viewer.open(source.source, { target: source, refs: message?.sources ?? [source] })
    },
    [viewer],
  )

  const empty = messages.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {empty && !loadingHistory && <EmptyState onPick={send} />}
      {empty && loadingHistory && <div className="flex-1" aria-busy="true" />}
      {!empty && <MessageList messages={messages} busy={busy} onOpenSource={openSource} />}
      <Composer />
    </div>
  )
}
