export type SSEHandler = (event: string, data: unknown) => void

/**
 * Incremental Server-Sent Events parser. Feed it raw text chunks; it calls
 * onEvent for every complete event (terminated by a blank line). Supports
 * LF/CRLF, multi-line data, events split across chunks and comment lines.
 */
export function createSSEParser(onEvent: SSEHandler): (chunk: string) => void {
  let buffer = ''

  function dispatch(block: string) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue
      const idx = line.indexOf(':')
      const field = idx === -1 ? line : line.slice(0, idx)
      let value = idx === -1 ? '' : line.slice(idx + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') dataLines.push(value)
    }
    if (dataLines.length === 0) return
    let data: unknown
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      return
    }
    onEvent(event, data)
  }

  return (chunk: string) => {
    // A trailing lone "\r" may be the first half of a "\r\n" split between chunks: keep it as is.
    buffer = (buffer + chunk).replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n')
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      dispatch(buffer.slice(0, sep))
      buffer = buffer.slice(sep + 2)
      sep = buffer.indexOf('\n\n')
    }
  }
}
