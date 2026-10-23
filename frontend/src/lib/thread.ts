const KEY = 'rag.threadId'

let memoryId: string | null = null

export function getThreadId(): string {
  try {
    const stored = localStorage.getItem(KEY)
    if (stored) return stored
  } catch {
    // localStorage unavailable: fall back to the in-memory id below
  }
  return memoryId ?? newThreadId()
}

export function newThreadId(): string {
  const id = crypto.randomUUID()
  memoryId = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // localStorage unavailable: the id lives in memory only
  }
  return id
}
