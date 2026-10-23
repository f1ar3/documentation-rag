import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/lib/api'
import App from './App'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, listDocuments: vi.fn(), getHistory: vi.fn() }
})

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a calm banner when the server has no GOOGLE_API_KEY', async () => {
    const err = new api.ApiError(503, 'Не задан GOOGLE_API_KEY')
    vi.mocked(api.listDocuments).mockRejectedValue(err)
    vi.mocked(api.getHistory).mockRejectedValue(err)
    render(<App />)
    expect(await screen.findByText('Сервер не настроен')).toBeInTheDocument()
    expect(screen.getByText(/Не задан GOOGLE_API_KEY/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
    // The chat stays usable: example questions are still offered.
    expect(screen.getByRole('button', { name: 'Какие документы загружены?' })).toBeInTheDocument()
  })

  it('lists documents in the phone menu and shows no banner when the server is fine', async () => {
    vi.mocked(api.listDocuments).mockResolvedValue([{ name: 'otpuska.pdf', chunks: 4 }])
    vi.mocked(api.getHistory).mockResolvedValue([])
    const user = userEvent.setup()
    render(<App />)
    // jsdom matchMedia reports no match, so the narrow layout with a slide-over menu is used.
    await user.click(screen.getByRole('button', { name: 'Открыть меню' }))
    expect(await screen.findByText('otpuska.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Сервер не настроен')).not.toBeInTheDocument()
  })
})
