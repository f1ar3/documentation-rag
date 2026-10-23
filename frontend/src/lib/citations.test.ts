import { describe, expect, it } from 'vitest'
import { sameSource, sourceLabel, splitCitations } from './citations'

describe('splitCitations', () => {
  it('splits a pdf citation between text', () => {
    expect(splitCitations('А [a.pdf, стр. 2] Б')).toEqual([
      { type: 'text', value: 'А ' },
      { type: 'cite', source: 'a.pdf', page: 2, section: null },
      { type: 'text', value: ' Б' },
    ])
  })

  it('parses a section citation', () => {
    expect(splitCitations('[b.docx, раздел "3. Суточные"]')).toEqual([
      { type: 'cite', source: 'b.docx', page: null, section: '3. Суточные' },
    ])
  })

  it('parses a bare file citation', () => {
    expect(splitCitations('Текст [faq.txt].')).toEqual([
      { type: 'text', value: 'Текст ' },
      { type: 'cite', source: 'faq.txt', page: null, section: null },
      { type: 'text', value: '.' },
    ])
  })

  it('supports cyrillic names with spaces', () => {
    expect(splitCitations('[Положение об отпусках.docx, раздел "2. Порядок"]')).toEqual([
      { type: 'cite', source: 'Положение об отпусках.docx', page: null, section: '2. Порядок' },
    ])
  })

  it('supports page without a space after the dot', () => {
    expect(splitCitations('[a.pdf, стр.3]')).toEqual([
      { type: 'cite', source: 'a.pdf', page: 3, section: null },
    ])
  })

  it('does not treat arbitrary bracketed text as a citation', () => {
    const text = 'Смотрите [просто текст в скобках] выше'
    expect(splitCitations(text)).toEqual([{ type: 'text', value: text }])
  })

  it('returns a single text part when there are no citations', () => {
    expect(splitCitations('Без меток')).toEqual([{ type: 'text', value: 'Без меток' }])
  })

  it('returns an empty list for empty text', () => {
    expect(splitCitations('')).toEqual([])
  })

  it('handles adjacent citations and uppercase extensions', () => {
    expect(splitCitations('[a.PDF, стр. 1][faq.txt]')).toEqual([
      { type: 'cite', source: 'a.PDF', page: 1, section: null },
      { type: 'cite', source: 'faq.txt', page: null, section: null },
    ])
  })
})

describe('sourceLabel', () => {
  it('formats the three kinds', () => {
    expect(sourceLabel({ source: 'a.pdf', page: 2, section: null })).toBe('a.pdf, стр. 2')
    expect(sourceLabel({ source: 'b.docx', page: null, section: '3. Суточные' })).toBe(
      'b.docx, «3. Суточные»',
    )
    expect(sourceLabel({ source: 'faq.txt', page: null, section: null })).toBe('faq.txt')
  })
})

describe('sameSource', () => {
  it('compares all fields', () => {
    const a = { source: 'a.pdf', page: 2, section: null }
    expect(sameSource(a, { ...a })).toBe(true)
    expect(sameSource(a, { ...a, page: 3 })).toBe(false)
    expect(sameSource(a, { ...a, source: 'b.pdf' })).toBe(false)
    expect(sameSource(a, { ...a, section: 'x' })).toBe(false)
  })
})
