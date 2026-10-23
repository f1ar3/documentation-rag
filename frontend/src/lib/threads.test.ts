import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadThreads, removeThread, threadTitle, touchThread } from './threads'

describe('threads list', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('creates a thread with a truncated title and keeps the newest first', () => {
    touchThread('t1', 'Первый вопрос', 1)
    touchThread('t2', 'x'.repeat(60), 2)
    const threads = loadThreads()
    expect(threads.map((t) => t.id)).toEqual(['t2', 't1'])
    expect(threads[0].title.length).toBeLessThanOrEqual(41)
    expect(threads[0].title.endsWith('…')).toBe(true)
  })

  it('keeps the original title and bumps updatedAt on repeated touches', () => {
    touchThread('t1', 'Первый', 1)
    touchThread('t2', 'Второй', 2)
    touchThread('t1', 'Другой текст', 3)
    const threads = loadThreads()
    expect(threads[0]).toEqual({ id: 't1', title: 'Первый', updatedAt: 3 })
  })

  it('removes a thread', () => {
    touchThread('t1', 'a', 1)
    removeThread('t1')
    expect(loadThreads()).toEqual([])
  })

  it('survives broken or unavailable storage', () => {
    localStorage.setItem('rag.threads', '{not json')
    expect(loadThreads()).toEqual([])
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => touchThread('t1', 'a', 1)).not.toThrow()
    expect(loadThreads()).toEqual([])
  })

  it('collapses whitespace in titles', () => {
    expect(threadTitle('  Сколько\n\nдней   отпуска?  ')).toBe('Сколько дней отпуска?')
  })
})
