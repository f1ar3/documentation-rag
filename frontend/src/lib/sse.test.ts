import { describe, expect, it } from 'vitest'
import { createSSEParser } from './sse'

function collect() {
  const events: Array<[string, unknown]> = []
  const feed = createSSEParser((event, data) => events.push([event, data]))
  return { events, feed }
}

describe('createSSEParser', () => {
  it('parses two events in one chunk', () => {
    const { events, feed } = collect()
    feed('event: token\ndata: {"text":"a"}\n\nevent: done\ndata: {}\n\n')
    expect(events).toEqual([
      ['token', { text: 'a' }],
      ['done', {}],
    ])
  })

  it('parses an event split into three chunks in the middle of data', () => {
    const { events, feed } = collect()
    feed('event: token\ndata: {"te')
    feed('xt":"при')
    expect(events).toEqual([])
    feed('вет"}\n\n')
    expect(events).toEqual([['token', { text: 'привет' }]])
  })

  it('supports CRLF line endings', () => {
    const { events, feed } = collect()
    feed('event: token\r\ndata: {"text":"x"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n')
    expect(events).toEqual([
      ['token', { text: 'x' }],
      ['done', {}],
    ])
  })

  it('handles a CRLF separator split between chunks', () => {
    const { events, feed } = collect()
    feed('event: token\r\ndata: {"text":"x"}\r\n\r')
    feed('\n')
    expect(events).toEqual([['token', { text: 'x' }]])
  })

  it('joins multi-line data with newline before JSON parsing', () => {
    const { events, feed } = collect()
    feed('event: sources\ndata: {"answer":"a",\ndata: "sources":[]}\n\n')
    expect(events).toEqual([['sources', { answer: 'a', sources: [] }]])
  })

  it('ignores comment lines such as pings', () => {
    const { events, feed } = collect()
    feed(': ping - 2026\r\n\r\nevent: done\r\ndata: {}\r\n\r\n')
    expect(events).toEqual([['done', {}]])
  })

  it('defaults event name to message and skips invalid JSON', () => {
    const { events, feed } = collect()
    feed('data: {"a":1}\n\n')
    feed('event: token\ndata: not json\n\n')
    expect(events).toEqual([['message', { a: 1 }]])
  })
})
