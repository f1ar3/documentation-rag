import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { ArrowUp, Paperclip, Square } from 'lucide-react'
import { ACCEPTED_EXTENSIONS } from '@/lib/files'
import { useChat } from '@/state/chat'
import { useOptionalDocuments } from '@/state/documents'
import { IconButton } from './IconButton'

const LINE_HEIGHT = 24
const MAX_LINES = 8
/** Same limit as the backend ChatRequest.message. */
const MAX_MESSAGE_LENGTH = 4000

export function Composer() {
  const { send, stop, busy, threadId } = useChat()
  const documents = useOptionalDocuments()
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const canSend = text.trim().length > 0 && !busy

  // Autosize up to MAX_LINES, then scroll inside the field.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = LINE_HEIGHT * MAX_LINES
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [text])

  // Focus the field when a chat opens (desktop only: on phones it would pop the keyboard).
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) textareaRef.current?.focus()
  }, [threadId])

  const submit = () => {
    if (!canSend) return
    send(text)
    setText('')
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
      <form onSubmit={onSubmit} className="mx-auto w-full max-w-[720px]">
        <div className="rounded-3xl border bg-card shadow-xs transition-[border-color,box-shadow] focus-within:border-ring/50 focus-within:shadow-sm dark:bg-muted/40">
          <textarea
            ref={textareaRef}
            aria-label="Сообщение"
            placeholder="Задайте вопрос по регламентам"
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div>
              {documents && (
                <>
                  <IconButton
                    label="Прикрепить документы"
                    side="top"
                    size="icon-lg"
                    className="rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Paperclip className="size-[18px]" aria-hidden />
                  </IconButton>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      e.target.value = ''
                      if (files.length) void documents.upload(files)
                    }}
                  />
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {busy && (
                <IconButton
                  label="Остановить"
                  side="top"
                  variant="outline"
                  size="icon-lg"
                  className="rounded-full"
                  onClick={stop}
                >
                  <Square className="size-3.5 fill-current" aria-hidden />
                </IconButton>
              )}
              <IconButton
                label="Отправить"
                side="top"
                type="submit"
                size="icon-lg"
                disabled={!canSend}
                className="rounded-full bg-brand text-brand-foreground hover:bg-brand/90 disabled:bg-muted-foreground/25 disabled:text-background disabled:opacity-100 dark:disabled:bg-muted dark:disabled:text-muted-foreground"
              >
                <ArrowUp className="size-[18px]" aria-hidden />
              </IconButton>
            </div>
          </div>
        </div>
      </form>
      <p className="mx-auto mt-2 max-w-[720px] text-center text-xs text-muted-foreground">
        Ответы основаны на загруженных документах. Проверяйте важное по источникам.
      </p>
    </div>
  )
}
