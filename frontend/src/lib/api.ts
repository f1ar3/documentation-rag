import { createSSEParser } from './sse'
import type { ChatMessage, DocumentInfo, Source } from './types'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type ChatHandlers = {
  onToken(text: string): void
  onSources(sources: Source[], answer: string): void
  onError(message: string): void
  onDone(): void
}

const NETWORK_ERROR = 'Не удалось связаться с сервером'
const STREAM_CUT = 'Ответ прервался, попробуйте ещё раз'

function detailToMessage(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) return 'Некорректный запрос'
  return `Ошибка запроса (${status})`
}

async function toApiError(response: Response): Promise<ApiError> {
  let detail: unknown
  try {
    detail = ((await response.json()) as { detail?: unknown }).detail
  } catch {
    detail = undefined
  }
  return new ApiError(response.status, detailToMessage(detail, response.status))
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new ApiError(0, NETWORK_ERROR)
  }
  if (!response.ok) throw await toApiError(response)
  return response
}

export async function listDocuments(): Promise<DocumentInfo[]> {
  const response = await request('/api/documents')
  return ((await response.json()) as { documents: DocumentInfo[] }).documents
}

export async function uploadDocuments(files: File[]): Promise<DocumentInfo[]> {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  const response = await request('/api/documents', { method: 'POST', body: form })
  return ((await response.json()) as { documents: DocumentInfo[] }).documents
}

export async function deleteDocument(name: string): Promise<void> {
  await request(`/api/documents/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function getHistory(threadId: string): Promise<ChatMessage[]> {
  const response = await request(`/api/chat/${encodeURIComponent(threadId)}/history`)
  return ((await response.json()) as { messages: ChatMessage[] }).messages
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export async function streamChat(
  threadId: string,
  message: string,
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let finished = false
  let errored = false
  const finish = () => {
    if (finished) return
    finished = true
    handlers.onDone()
  }

  const parse = createSSEParser((event, data) => {
    if (finished) return
    const payload = (data ?? {}) as Record<string, unknown>
    if (event === 'token') {
      handlers.onToken(String(payload.text ?? ''))
    } else if (event === 'sources') {
      handlers.onSources((payload.sources as Source[]) ?? [], String(payload.answer ?? ''))
    } else if (event === 'error') {
      errored = true
      handlers.onError(String(payload.message ?? NETWORK_ERROR))
    } else if (event === 'done') {
      finish()
    }
  })

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, message }),
      signal,
    })
    if (!response.ok) {
      handlers.onError((await toApiError(response)).message)
      return
    }
    if (!response.body) {
      handlers.onError(NETWORK_ERROR)
      return
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parse(decoder.decode(value, { stream: true }))
    }
    parse(decoder.decode())
    // The stream closed without "done" or "error": the answer was cut off.
    if (!finished && !errored) handlers.onError(STREAM_CUT)
  } catch (err) {
    if (!isAbort(err)) handlers.onError(NETWORK_ERROR)
  } finally {
    finish()
  }
}
