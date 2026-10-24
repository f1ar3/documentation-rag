export type Source = { source: string; page: number | null; section: string | null }

export type DocumentInfo = { name: string; chunks: number }

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  sources: Source[]
}

export type DocumentPart = { page: number | null; section: string | null; text: string }

export type DocumentContent = {
  name: string
  format: 'pdf' | 'docx' | 'md' | 'txt'
  parts: DocumentPart[]
}
