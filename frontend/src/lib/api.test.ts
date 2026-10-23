import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  deleteDocument,
  getHistory,
  listDocuments,
  streamChat,
  uploadDocuments,
} from './api'

function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function handlers() {
  return {
    onToken: vi.fn(),
    onSources: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamChat', () => {
  it('calls onToken twice, onSources with answer, then onDone', async () => {
    const sources = [{ source: 'a.pdf', page: 2, section: null }]
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: token\r\ndata: {"text":"При"}\r\n\r\nevent: tok',
        'en\r\ndata: {"text":"вет"}\r\n\r\n',
        `event: sources\r\ndata: ${JSON.stringify({ answer: 'Привет [a.pdf, стр. 2]', sources })}\r\n\r\n`,
        'event: done\r\ndata: {}\r\n\r\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const h = handlers()

    await streamChat('t1', 'Вопрос', h)

    expect(h.onToken.mock.calls).toEqual([['При'], ['вет']])
    expect(h.onSources).toHaveBeenCalledTimes(1)
    expect(h.onSources).toHaveBeenCalledWith(sources, 'Привет [a.pdf, стр. 2]')
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onDone).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/chat')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ thread_id: 't1', message: 'Вопрос' })
  })

  it('calls onError for an error event and still onDone', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse(['event: error\ndata: {"message":"Сбой"}\n\nevent: done\ndata: {}\n\n']),
        ),
    )
    const h = handlers()
    await streamChat('t1', 'q', h)
    expect(h.onError).toHaveBeenCalledWith('Сбой')
    expect(h.onSources).not.toHaveBeenCalled()
    expect(h.onDone).toHaveBeenCalledTimes(1)
  })

  it('maps a 503 before the stream to onError + onDone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'Не задан GOOGLE_API_KEY' }, 503)),
    )
    const h = handlers()
    await streamChat('t1', 'q', h)
    expect(h.onError).toHaveBeenCalledWith('Не задан GOOGLE_API_KEY')
    expect(h.onDone).toHaveBeenCalledTimes(1)
    expect(h.onToken).not.toHaveBeenCalled()
  })

  it('maps a 422 list detail to a readable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: [{ msg: 'field required' }] }, 422)),
    )
    const h = handlers()
    await streamChat('t1', '', h)
    expect(h.onError).toHaveBeenCalledWith('Некорректный запрос')
    expect(h.onDone).toHaveBeenCalledTimes(1)
  })

  it('reports a network failure via onError + onDone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const h = handlers()
    await streamChat('t1', 'q', h)
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onDone).toHaveBeenCalledTimes(1)
  })

  it('reports a stream cut without done and calls onDone once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['event: token\ndata: {"text":"a"}\n\n'])),
    )
    const h = handlers()
    await streamChat('t1', 'q', h)
    expect(h.onToken).toHaveBeenCalledWith('a')
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onError).toHaveBeenCalledWith('Ответ прервался, попробуйте ещё раз')
    expect(h.onDone).toHaveBeenCalledTimes(1)
    expect(h.onError.mock.invocationCallOrder[0]).toBeLessThan(
      h.onDone.mock.invocationCallOrder[0],
    )
  })

  it('does not report a cut after an error event without done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['event: error\ndata: {"message":"Сбой"}\n\n'])),
    )
    const h = handlers()
    await streamChat('t1', 'q', h)
    expect(h.onError.mock.calls).toEqual([['Сбой']])
    expect(h.onDone).toHaveBeenCalledTimes(1)
  })

  it('on abort calls onDone without onError', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        })
      }),
    )
    const h = handlers()
    const promise = streamChat('t1', 'q', h, controller.signal)
    controller.abort()
    await promise
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onDone).toHaveBeenCalledTimes(1)
  })
})

describe('REST helpers', () => {
  it('listDocuments returns the documents array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ documents: [{ name: 'a.pdf', chunks: 3 }] })),
    )
    expect(await listDocuments()).toEqual([{ name: 'a.pdf', chunks: 3 }])
  })

  it('listDocuments throws ApiError with status 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'Не задан GOOGLE_API_KEY' }, 503)),
    )
    const err = await listDocuments().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(503)
    expect(err.message).toBe('Не задан GOOGLE_API_KEY')
  })

  it('ApiError falls back to a generic message for non-JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })))
    const err = await listDocuments().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(502)
    expect(err.message).toBeTruthy()
  })

  it('uploadDocuments posts multipart with field files', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ documents: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await uploadDocuments([new File(['a'], 'a.txt'), new File(['b'], 'b.md')])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/documents')
    expect(init.method).toBe('POST')
    const body = init.body as FormData
    expect(body.getAll('files').map((f) => (f as File).name)).toEqual(['a.txt', 'b.md'])
    expect(init.headers).toBeUndefined()
  })

  it('deleteDocument encodes the name and resolves on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await deleteDocument('Положение об отпусках.docx')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/documents/${encodeURIComponent('Положение об отпусках.docx')}`)
    expect(init.method).toBe('DELETE')
  })

  it('deleteDocument throws ApiError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'Не найден' }, 404)))
    const err = await deleteDocument('x.pdf').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(404)
  })

  it('getHistory returns messages and encodes the thread id', async () => {
    const messages = [{ role: 'user', content: 'q', sources: [] }]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ messages }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getHistory('a/b')).toEqual(messages)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/a%2Fb/history')
  })
})
