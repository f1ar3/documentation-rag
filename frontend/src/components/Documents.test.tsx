import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/lib/api'
import { Documents } from './Documents'
import { DocumentsProvider } from '@/state/documents'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    listDocuments: vi.fn(),
    deleteDocument: vi.fn(),
    uploadDocuments: vi.fn(),
  }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const listDocuments = vi.mocked(api.listDocuments)
const deleteDocument = vi.mocked(api.deleteDocument)
const uploadDocuments = vi.mocked(api.uploadDocuments)

function renderDocs() {
  return render(
    <DocumentsProvider>
      <Documents />
    </DocumentsProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listDocuments.mockResolvedValue([
    { name: 'a.pdf', chunks: 3 },
    { name: 'b.md', chunks: 2 },
  ])
  deleteDocument.mockResolvedValue(undefined)
})

describe('Documents', () => {
  it('deletes a document after confirmation', async () => {
    const user = userEvent.setup()
    renderDocs()
    await screen.findByText('a.pdf')
    await user.click(screen.getByRole('button', { name: 'Удалить a.pdf' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(deleteDocument).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    expect(deleteDocument).toHaveBeenCalledWith('a.pdf')
    await waitFor(() => expect(screen.queryByText('a.pdf')).not.toBeInTheDocument())
    expect(screen.getByText('b.md')).toBeInTheDocument()
  })

  it('keeps the document when the dialog is cancelled', async () => {
    const user = userEvent.setup()
    renderDocs()
    await screen.findByText('a.pdf')
    await user.click(screen.getByRole('button', { name: 'Удалить a.pdf' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(deleteDocument).not.toHaveBeenCalled()
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
  })

  it('shows the server error in a toast when deletion fails', async () => {
    deleteDocument.mockRejectedValue(new api.ApiError(404, 'Документ не найден'))
    const user = userEvent.setup()
    renderDocs()
    await screen.findByText('a.pdf')
    await user.click(screen.getByRole('button', { name: 'Удалить a.pdf' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Документ не найден'))
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
  })

  it('filters unsupported files on the client and uploads the rest', async () => {
    uploadDocuments.mockResolvedValue([{ name: 'c.txt', chunks: 1 }])
    const user = userEvent.setup({ applyAccept: false })
    renderDocs()
    await screen.findByText('a.pdf')
    const input = screen.getByLabelText('Выбрать файлы для загрузки')
    await user.upload(input, [new File(['x'], 'pic.png'), new File(['y'], 'c.txt')])
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('pic.png'))
    await waitFor(() => expect(uploadDocuments).toHaveBeenCalledTimes(1))
    expect(uploadDocuments.mock.calls[0][0].map((f) => f.name)).toEqual(['c.txt'])
    expect(await screen.findByText('c.txt')).toBeInTheDocument()
  })

  it('shows an upload error from the server in a toast', async () => {
    uploadDocuments.mockRejectedValue(
      new api.ApiError(400, 'Не удалось извлечь текст из scan.pdf'),
    )
    const user = userEvent.setup()
    renderDocs()
    await screen.findByText('a.pdf')
    await user.upload(screen.getByLabelText('Выбрать файлы для загрузки'), [
      new File(['x'], 'scan.pdf'),
    ])
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Не удалось извлечь текст из scan.pdf'),
    )
    await waitFor(() => expect(screen.queryByText('scan.pdf')).not.toBeInTheDocument())
  })
})
