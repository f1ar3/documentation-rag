import { useCallback, useMemo, useState } from 'react'
import type { Source } from '@/lib/types'
import { useChat } from '@/state/chat'
import { Composer } from './Composer'
import { EmptyState } from './EmptyState'
import { MessageList } from './MessageList'
import { SourceSheet } from './SourceSheet'

/** Conversation pane: feed (or empty state), composer and the source sheet. */
export function Chat() {
  const { messages, busy, loadingHistory, send } = useChat()
  const [selected, setSelected] = useState<{ messageId: string; source: Source } | null>(null)

  const openSource = useCallback(
    (messageId: string, source: Source) => setSelected({ messageId, source }),
    [],
  )

  const selection = useMemo(() => {
    if (!selected) return null
    const message = messages.find((m) => m.id === selected.messageId)
    return message ? { source: selected.source, answerSources: message.sources } : null
  }, [selected, messages])

  const empty = messages.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {empty && !loadingHistory && <EmptyState onPick={send} />}
      {empty && loadingHistory && <div className="flex-1" aria-busy="true" />}
      {!empty && <MessageList messages={messages} busy={busy} onOpenSource={openSource} />}
      <Composer />
      <SourceSheet
        selection={selection}
        onSelect={(source) => setSelected((prev) => (prev ? { ...prev, source } : prev))}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
