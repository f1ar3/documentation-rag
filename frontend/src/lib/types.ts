export type Source = { source: string; page: number | null; section: string | null }

export type DocumentInfo = { name: string; chunks: number }

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  sources: Source[]
}
