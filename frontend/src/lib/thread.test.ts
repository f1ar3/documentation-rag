import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getThreadId, newThreadId } from './thread'

describe('thread id', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('returns the same id on repeated calls and persists it', () => {
    const first = getThreadId()
    expect(first).toBeTruthy()
    expect(getThreadId()).toBe(first)
    expect(localStorage.getItem('rag.threadId')).toBe(first)
  })

  it('newThreadId replaces the stored value', () => {
    const first = getThreadId()
    const second = newThreadId()
    expect(second).not.toBe(first)
    expect(getThreadId()).toBe(second)
  })

  it('falls back to an in-memory id when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const id = getThreadId()
    expect(id).toBeTruthy()
    expect(getThreadId()).toBe(id)
    expect(newThreadId()).not.toBe(id)
  })
})
