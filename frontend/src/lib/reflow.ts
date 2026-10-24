// A line that starts a new block: a numbered clause ("2.", "3.1.", "4.2)") or a list marker.
const BLOCK_START = /^(\d+(\.\d+)*[.)]\s|[-•*–]\s)/
const SENTENCE_END = /[.!?:;]$/
const CAPITAL_OR_DIGIT = /^[A-ZА-ЯЁ0-9«"]/

/**
 * PDF text comes with a line break at the end of every printed line. For reading on any width the
 * lines of a paragraph are joined back; clauses, list items and new sentences keep their breaks.
 */
export function reflowPdfText(text: string): string {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const prev = out.length > 0 ? out[out.length - 1] : null
    const startsBlock =
      prev === null ||
      prev === '' ||
      line === '' ||
      BLOCK_START.test(line) ||
      (SENTENCE_END.test(prev) && CAPITAL_OR_DIGIT.test(line))
    if (startsBlock) out.push(line)
    else out[out.length - 1] = `${prev} ${line.trimStart()}`
  }
  return out.join('\n')
}
