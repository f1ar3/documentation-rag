import { describe, expect, it } from 'vitest'
import { reflowPdfText } from './reflow'

describe('reflowPdfText', () => {
  it('joins lines broken by the PDF layout', () => {
    expect(reflowPdfText('Заявление подаётся не позднее чем за 14 календарных\nдней до начала.')).toBe(
      'Заявление подаётся не позднее чем за 14 календарных дней до начала.',
    )
  })

  it('keeps numbered clauses and headings on their own lines', () => {
    const text = '2. Продолжительность\n2.1. Отпуск 28 дней\nза рабочий год.\n2.2. Право возникает\nпосле 6 месяцев.'
    expect(reflowPdfText(text)).toBe(
      '2. Продолжительность\n2.1. Отпуск 28 дней за рабочий год.\n2.2. Право возникает после 6 месяцев.',
    )
  })

  it('keeps a break after a finished sentence followed by a capital letter, and list markers', () => {
    expect(reflowPdfText('Конец фразы.\nНовая фраза\n- пункт\n• ещё')).toBe('Конец фразы.\nНовая фраза\n- пункт\n• ещё')
  })

  it('keeps blank lines and trims trailing spaces of joined lines', () => {
    expect(reflowPdfText('Абзац один  \nпродолжение\n\nАбзац два')).toBe('Абзац один продолжение\n\nАбзац два')
  })
})
