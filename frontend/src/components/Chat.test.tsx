import { act, render, screen, waitFor, within } from '@testing-library/react'
import type { ChatMessage } from '@/lib/types'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatHandlers } from '@/lib/api'
import * as api from '@/lib/api'
import { Chat } from './Chat'
import { ChatProvider, useChat } from '@/state/chat'

function NewChatButton() {
  const { newChat } = useChat()
  return (
    <button type="button" onClick={newChat}>
      test-new-chat
    </button>
  )
}

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, streamChat: vi.fn(), getHistory: vi.fn() }
})

const streamChat = vi.mocked(api.streamChat)
const getHistory = vi.mocked(api.getHistory)

let handlers: ChatHandlers
let signal: AbortSignal | undefined

beforeEach(() => {
  vi.clearAllMocks()
  getHistory.mockResolvedValue([])
  streamChat.mockImplementation((_thread, _message, h, s) => {
    handlers = h
    signal = s
    return new Promise<void>(() => {})
  })
})

async function renderAndAsk(question = 'Сколько дней отпуска?') {
  const user = userEvent.setup()
  render(
    <ChatProvider>
      <Chat />
    </ChatProvider>,
  )
  await waitFor(() => expect(getHistory).toHaveBeenCalled())
  const box = screen.getByRole('textbox', { name: 'Сообщение' })
  await user.type(box, question)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(streamChat).toHaveBeenCalled())
  return user
}

describe('Chat', () => {
  it('streams tokens, turns a known label into a chip and disables send while streaming', async () => {
    const user = await renderAndAsk()
    // Non-empty text: the button is disabled only because a reply is streaming.
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Следующий вопрос')
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Остановить' })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(streamChat).toHaveBeenCalledTimes(1)

    act(() => {
      handlers.onToken('28 дней ')
      handlers.onToken('[a.pdf, стр. 1]')
    })
    expect(await screen.findByText(/28 дней/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()

    act(() => {
      handlers.onSources([{ source: 'a.pdf', page: 1, section: null }], '28 дней [a.pdf, стр. 1]')
      handlers.onDone()
    })
    const paragraph = (await screen.findByText(/28 дней/)).closest('p') as HTMLElement
    expect(within(paragraph).getByRole('button', { name: 'a.pdf · стр. 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Остановить' })).not.toBeInTheDocument()
  })

  it('shows the onError text in the feed and keeps the partial answer', async () => {
    await renderAndAsk()
    act(() => {
      handlers.onToken('Частичный ответ')
      handlers.onError('Превышен лимит запросов к Gemini API, попробуйте позже')
      handlers.onDone()
    })
    expect(
      await screen.findByText('Превышен лимит запросов к Gemini API, попробуйте позже'),
    ).toBeInTheDocument()
    expect(screen.getByText('Частичный ответ')).toBeInTheDocument()
  })

  it('shows a search status until the first token arrives', async () => {
    await renderAndAsk()
    expect(screen.getByText('Ищу в документах...')).toBeInTheDocument()
    act(() => handlers.onToken('Ответ'))
    await waitFor(() => expect(screen.queryByText('Ищу в документах...')).not.toBeInTheDocument())
  })

  it('renders labels missing from sources as plain text', async () => {
    await renderAndAsk()
    act(() => {
      handlers.onSources(
        [{ source: 'a.pdf', page: 1, section: null }],
        'Да [a.pdf, стр. 1], и ещё [b.pdf, стр. 9]',
      )
      handlers.onDone()
    })
    expect(await screen.findAllByRole('button', { name: 'a.pdf · стр. 1' })).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'b.pdf · стр. 9' })).not.toBeInTheDocument()
    expect(screen.getByText(/\[b\.pdf, стр\. 9\]/)).toBeInTheDocument()
  })

  it('renders chips inside markdown list items', async () => {
    await renderAndAsk()
    act(() => {
      handlers.onSources(
        [{ source: 'b.docx', page: null, section: '3. Суточные' }],
        'Суточные:\n\n- 700 рублей [b.docx, раздел "3. Суточные"]\n- второй пункт',
      )
      handlers.onDone()
    })
    const chip = await screen.findAllByRole('button', { name: 'b.docx · «3. Суточные»' })
    expect(chip[0].closest('li')).not.toBeNull()
  })

  it('replaces the streamed text with the final answer from the sources event', async () => {
    await renderAndAsk()
    act(() => handlers.onToken('Сейчас поищу.'))
    expect(await screen.findByText('Сейчас поищу.')).toBeInTheDocument()
    act(() => {
      handlers.onSources([{ source: 'a.pdf', page: 1, section: null }], 'Ответ [a.pdf, стр. 1].')
      handlers.onDone()
    })
    const paragraph = (await screen.findByText(/^Ответ /)).closest('p') as HTMLElement
    expect(paragraph).toHaveTextContent('Ответ a.pdf · стр. 1.')
    expect(within(paragraph).getByRole('button', { name: 'a.pdf · стр. 1' })).toBeInTheDocument()
    expect(screen.queryByText(/Сейчас поищу/)).not.toBeInTheDocument()
  })

  it('keeps the new question and answer when history arrives after a send', async () => {
    let resolveHistory: (messages: ChatMessage[]) => void = () => {}
    getHistory.mockReturnValue(new Promise((resolve) => (resolveHistory = resolve)))
    const user = userEvent.setup()
    render(
      <ChatProvider>
        <Chat />
      </ChatProvider>,
    )
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Ранний вопрос{Enter}')
    await waitFor(() => expect(streamChat).toHaveBeenCalled())
    await act(async () => resolveHistory([{ role: 'user', content: 'Старый вопрос', sources: [] }]))
    act(() => handlers.onToken('Свежий ответ'))
    expect(await screen.findByText('Свежий ответ')).toBeInTheDocument()
    expect(screen.getByText('Ранний вопрос')).toBeInTheDocument()
  })

  it('a new chat during a stream aborts it, resets busy and ignores late tokens', async () => {
    const user = userEvent.setup()
    render(
      <ChatProvider>
        <NewChatButton />
        <Chat />
      </ChatProvider>,
    )
    await waitFor(() => expect(getHistory).toHaveBeenCalled())
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Вопрос{Enter}')
    await waitFor(() => expect(streamChat).toHaveBeenCalled())
    const oldHandlers = handlers
    const oldSignal = signal
    await user.click(screen.getByRole('button', { name: 'test-new-chat' }))
    expect(oldSignal?.aborted).toBe(true)
    act(() => {
      oldHandlers.onToken('Поздний токен')
      oldHandlers.onDone()
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Поздний токен/)).not.toBeInTheDocument()
    expect(screen.queryByText('Вопрос')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Остановить' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Другой')
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled()
  })

  it('stop aborts the stream', async () => {
    const user = await renderAndAsk()
    await user.click(screen.getByRole('button', { name: 'Остановить' }))
    expect(signal?.aborted).toBe(true)
  })

  it('limits the message field to 4000 characters like the server', () => {
    render(
      <ChatProvider>
        <Chat />
      </ChatProvider>,
    )
    expect(screen.getByRole('textbox', { name: 'Сообщение' })).toHaveAttribute('maxlength', '4000')
  })

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const user = userEvent.setup()
    render(
      <ChatProvider>
        <Chat />
      </ChatProvider>,
    )
    const box = screen.getByRole('textbox', { name: 'Сообщение' })
    await user.type(box, 'строка{Shift>}{Enter}{/Shift}вторая')
    expect(box).toHaveValue('строка\nвторая')
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('sends with the send button and clears the field', async () => {
    const user = userEvent.setup()
    render(
      <ChatProvider>
        <Chat />
      </ChatProvider>,
    )
    const box = screen.getByRole('textbox', { name: 'Сообщение' })
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    await user.type(box, 'Вопрос')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(streamChat).toHaveBeenCalledWith(
      expect.any(String),
      'Вопрос',
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(box).toHaveValue('')
  })

  it('sends an example question from the empty state', async () => {
    const user = userEvent.setup()
    render(
      <ChatProvider>
        <Chat />
      </ChatProvider>,
    )
    await user.click(
      await screen.findByRole('button', { name: 'Сколько дней ежегодного отпуска положено?' }),
    )
    expect(streamChat).toHaveBeenCalledWith(
      expect.any(String),
      'Сколько дней ежегодного отпуска положено?',
      expect.any(Object),
      expect.any(AbortSignal),
    )
  })
})
