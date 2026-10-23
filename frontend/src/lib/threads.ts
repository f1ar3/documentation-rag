/**
 * Local list of chats for the sidebar. The backend has no "list threads"
 * endpoint, so this is a per-browser convenience stored in localStorage.
 */
export type ThreadInfo = { id: string; title: string; updatedAt: number }

const KEY = 'rag.threads'
const TITLE_MAX = 40
const LIMIT = 50

export function threadTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX).trimEnd()}…` : clean
}

function isThread(value: unknown): value is ThreadInfo {
  const t = value as ThreadInfo
  return (
    typeof t === 'object' &&
    t !== null &&
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    typeof t.updatedAt === 'number'
  )
}

export function loadThreads(): ThreadInfo[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isThread).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

function save(threads: ThreadInfo[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(threads.slice(0, LIMIT)))
  } catch {
    // storage unavailable or full: the list simply is not persisted
  }
}

/** Adds the thread (titled by its first message) or bumps its updatedAt. */
export function touchThread(id: string, firstMessage: string, now = Date.now()): ThreadInfo[] {
  const threads = loadThreads()
  const existing = threads.find((t) => t.id === id)
  const updated: ThreadInfo = existing
    ? { ...existing, updatedAt: now }
    : { id, title: threadTitle(firstMessage) || 'Новый чат', updatedAt: now }
  const next = [updated, ...threads.filter((t) => t.id !== id)]
  save(next)
  return next
}

export function removeThread(id: string): ThreadInfo[] {
  const next = loadThreads().filter((t) => t.id !== id)
  save(next)
  return next
}
