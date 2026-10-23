import { describe, expect, it } from 'vitest'
import { ACCEPTED_EXTENSIONS, isAccepted } from './files'

const f = (name: string) => new File(['x'], name)

describe('isAccepted', () => {
  it('accepts supported extensions case-insensitively', () => {
    for (const name of ['a.PDF', 'b.docx', 'c.md', 'd.txt']) {
      expect(isAccepted(f(name))).toBe(true)
    }
  })

  it('rejects other files', () => {
    for (const name of ['e.doc', 'f.png', 'pdf', 'g.pdf.exe']) {
      expect(isAccepted(f(name))).toBe(false)
    }
  })

  it('exposes the extension list', () => {
    expect(ACCEPTED_EXTENSIONS).toEqual(['.pdf', '.docx', '.md', '.txt'])
  })
})
