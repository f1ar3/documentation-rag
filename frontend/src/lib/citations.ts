import type { Source } from './types'

export type CitationPart = { type: 'text'; value: string } | ({ type: 'cite' } & Source)

// Mirrors CITATION_RE in backend/app/citations.py (three label kinds).
const CITATION_RE = new RegExp(
  String.raw`\[\s*([^\[\]"\n]+?\.(?:pdf|docx|md|txt))` +
    String.raw`(?:\s*,\s*стр\.\s?(\d+)|\s*,\s*раздел\s+"([^"\[\]\n]+)")?` +
    String.raw`\s*\]`,
  'gi',
)

export function splitCitations(text: string): CitationPart[] {
  const parts: CitationPart[] = []
  let last = 0
  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) })
    parts.push({
      type: 'cite',
      source: match[1].trim(),
      page: match[2] !== undefined ? Number(match[2]) : null,
      section: match[3] ?? null,
    })
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

export function sourceLabel(src: Source): string {
  if (src.page !== null) return `${src.source} · стр. ${src.page}`
  if (src.section !== null) return `${src.source} · «${src.section}»`
  return src.source
}

export function sameSource(a: Source, b: Source): boolean {
  return a.source === b.source && a.page === b.page && a.section === b.section
}
