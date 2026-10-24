import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/lib/api'
import type { DocumentContent } from '@/lib/types'
import { ChatProvider } from '@/state/chat'
import type { UiMessage } from '@/state/chat'
import { ViewerProvider, useDocumentViewer } from '@/state/viewer'
import { Chat } from './Chat'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, getDocumentContent: vi.fn(), getHistory: vi.fn() }
})

const getDocumentContent = vi.mocked(api.getDocumentContent)

const PDF: DocumentContent = {
  name: 'otpuska.pdf',
  format: 'pdf',
  parts: [
    { page: 1, section: null, text: 'Отпуск 28 календарных дней.' },
    { page: 2, section: null, text: 'Отпуск можно делить на части.' },
    { page: 3, section: null, text: 'Заявление подаётся заранее.' },
  ],
}

const MD: DocumentContent = {
  name: 'rules.md',
  format: 'md',
  parts: [
    { page: null, section: 'Общие положения', text: 'Ноутбук **выдаётся** бесплатно.' },
    { page: null, section: 'Связь', text: '- почта\n- мессенджер' },
  ],
}

const DOCX: DocumentContent = {
  name: 'komandirovki.docx',
  format: 'docx',
  parts: [
    { page: null, section: null, text: 'Вступление.' },
    { page: null, section: '1. Общие положения', text: 'Текст.' },
    { page: null, section: '3. Суточные', text: 'Москва | 700 руб.' },
  ],
}

const TXT: DocumentContent = {
  name: 'faq.txt',
  format: 'txt',
  parts: [{ page: null, section: null, text: 'Строка 1\nСтрока 2' }],
}

// jsdom has no scrollIntoView; record which elements were scrolled to.
const scrolled: Element[] = []
const originalScrollIntoView = Element.prototype.scrollIntoView

beforeAll(() => {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    scrolled.push(this)
  }
})

afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView
})

beforeEach(() => {
  vi.clearAllMocks()
  scrolled.length = 0
  vi.mocked(api.getHistory).mockResolvedValue([])
})

function OpenButton({ name }: { name: string }) {
  const { open } = useDocumentViewer()
  return (
    <button type="button" onClick={() => open(name)}>
      test-open
    </button>
  )
}

async function openDocument(content: DocumentContent | Error) {
  if (content instanceof Error) getDocumentContent.mockRejectedValue(content)
  else getDocumentContent.mockResolvedValue(content)
  const user = userEvent.setup()
  render(
    <ViewerProvider>
      <OpenButton name={content instanceof Error ? 'broken.pdf' : content.name} />
    </ViewerProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'test-open' }))
  return { user, dialog: await screen.findByRole('dialog') }
}

describe('DocumentViewer', () => {
  it('shows the name, format, table of contents and every part', async () => {
    const { dialog } = await openDocument(PDF)
    expect(getDocumentContent).toHaveBeenCalledWith('otpuska.pdf')
    expect(within(dialog).getByRole('heading', { name: 'otpuska.pdf' })).toBeInTheDocument()
    expect(within(dialog).getByText('PDF')).toBeInTheDocument()
    const toc = await within(dialog).findByRole('navigation', { name: 'Оглавление' })
    expect(within(toc).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Стр. 1',
      'Стр. 2',
      'Стр. 3',
    ])
    const page2 = within(dialog).getByRole('region', { name: 'Страница 2' })
    expect(page2).toHaveTextContent('Отпуск можно делить на части.')
    expect(within(dialog).getByText('Заявление подаётся заранее.')).toBeInTheDocument()
  })

  it('links "Открыть оригинал" to the original file in a new tab', async () => {
    const { dialog } = await openDocument(PDF)
    const link = within(dialog).getByRole('link', { name: /Открыть оригинал/ })
    expect(link).toHaveAttribute('href', api.documentFileUrl('otpuska.pdf'))
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('scrolls to a part from the table of contents', async () => {
    const { user, dialog } = await openDocument(PDF)
    const toc = await within(dialog).findByRole('navigation', { name: 'Оглавление' })
    await user.click(within(toc).getByRole('button', { name: 'Стр. 3' }))
    expect(scrolled.at(-1)).toBe(within(dialog).getByRole('region', { name: 'Страница 3' }))
  })

  it('renders markdown parts as markdown under their section titles', async () => {
    const { dialog } = await openDocument(MD)
    const section = await within(dialog).findByRole('region', { name: 'Общие положения' })
    expect(within(section).getByText('выдаётся').tagName).toBe('STRONG')
    expect(within(section).queryByText(/\*\*/)).not.toBeInTheDocument()
    const list = within(dialog).getByRole('region', { name: 'Связь' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    const toc = within(dialog).getByRole('navigation', { name: 'Оглавление' })
    expect(within(toc).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Общие положения',
      'Связь',
    ])
  })

  it('shows plain text with line breaks and no table of contents for TXT', async () => {
    const { dialog } = await openDocument(TXT)
    const text = await within(dialog).findByText(/Строка 1/)
    expect(text.textContent).toBe('Строка 1\nСтрока 2')
    expect(text).toHaveClass('whitespace-pre-wrap')
    expect(within(dialog).queryByRole('navigation', { name: 'Оглавление' })).not.toBeInTheDocument()
  })

  it('shows the server error and loads again on "Повторить"', async () => {
    const { user, dialog } = await openDocument(new api.ApiError(404, 'Документ broken.pdf не найден'))
    expect(await within(dialog).findByText('Документ broken.pdf не найден')).toBeInTheDocument()
    getDocumentContent.mockResolvedValue({ ...PDF, name: 'broken.pdf' })
    await user.click(within(dialog).getByRole('button', { name: 'Повторить' }))
    expect(await within(dialog).findByText('Отпуск можно делить на части.')).toBeInTheDocument()
    expect(getDocumentContent).toHaveBeenCalledTimes(2)
    expect(within(dialog).queryByText('Документ broken.pdf не найден')).not.toBeInTheDocument()
  })
})

const answer: UiMessage = {
  id: 'm2',
  role: 'assistant',
  content:
    'Отпуск 28 дней [otpuska.pdf, стр. 1], делится на части [otpuska.pdf, стр. 2]. ' +
    'Суточные [komandirovki.docx, раздел "3. Суточные"].',
  sources: [
    { source: 'otpuska.pdf', page: 1, section: null },
    { source: 'otpuska.pdf', page: 2, section: null },
    { source: 'komandirovki.docx', page: null, section: '3. Суточные' },
  ],
  status: 'done',
}

function renderChat() {
  const user = userEvent.setup()
  render(
    <ViewerProvider>
      <ChatProvider initialMessages={[{ id: 'm1', role: 'user', content: 'Вопрос', sources: [], status: 'done' }, answer]}>
        <Chat />
      </ChatProvider>
    </ViewerProvider>,
  )
  return user
}

describe('Opening the viewer from a citation', () => {
  it('opens the cited page, scrolls to it and lists the other refs of the answer to this file', async () => {
    getDocumentContent.mockResolvedValue(PDF)
    const user = renderChat()
    const chips = screen.getAllByRole('button', { name: 'otpuska.pdf · стр. 2' })
    await user.click(chips[0])
    const dialog = await screen.findByRole('dialog')
    expect(getDocumentContent).toHaveBeenCalledWith('otpuska.pdf')
    const page2 = await within(dialog).findByRole('region', { name: 'Страница 2' })
    await waitFor(() => expect(scrolled.at(-1)).toBe(page2))
    expect(page2).toHaveAttribute('data-highlighted')

    const refs = within(dialog).getByRole('group', { name: 'Ссылки ответа на этот файл' })
    const refButtons = within(refs).getAllByRole('button')
    expect(refButtons.map((b) => b.textContent)).toEqual(['стр. 1', 'стр. 2'])
    expect(refButtons[1]).toHaveAttribute('aria-current', 'true')

    await user.click(refButtons[0])
    const page1 = within(dialog).getByRole('region', { name: 'Страница 1' })
    await waitFor(() => expect(scrolled.at(-1)).toBe(page1))
    expect(page1).toHaveAttribute('data-highlighted')
    expect(page2).not.toHaveAttribute('data-highlighted')
    expect(getDocumentContent).toHaveBeenCalledTimes(1)
  })

  it('opens a DOCX at the cited section', async () => {
    getDocumentContent.mockResolvedValue(DOCX)
    const user = renderChat()
    await user.click(screen.getAllByRole('button', { name: 'komandirovki.docx · «3. Суточные»' })[0])
    const dialog = await screen.findByRole('dialog')
    const section = await within(dialog).findByRole('region', { name: '3. Суточные' })
    await waitFor(() => expect(scrolled.at(-1)).toBe(section))
    expect(within(dialog).getByRole('region', { name: 'Начало' })).toHaveTextContent('Вступление.')
  })

  it('opens at the top without an error when the cited part is missing', async () => {
    getDocumentContent.mockResolvedValue({ ...PDF, parts: PDF.parts.slice(0, 1) })
    const user = renderChat()
    await user.click(screen.getAllByRole('button', { name: 'otpuska.pdf · стр. 2' })[0])
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Отпуск 28 календарных дней.')).toBeInTheDocument()
    expect(scrolled).toHaveLength(0)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })
})
