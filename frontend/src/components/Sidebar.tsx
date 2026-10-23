import { PanelLeftClose, SquarePen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChat } from '@/state/chat'
import { Documents } from './Documents'
import { IconButton } from './IconButton'
import { ThemeSwitch } from './ThemeSwitch'

export function Sidebar({
  mode,
  onClose,
}: {
  /** desktop: collapsible column; mobile: content of the slide-over sheet */
  mode: 'desktop' | 'mobile'
  onClose(): void
}) {
  const { threads, threadId, newChat, selectThread, forgetThread } = useChat()
  const afterNavigate = () => {
    if (mode === 'mobile') onClose()
  }

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
        <span className="text-[15px] font-semibold tracking-tight">Регламенты</span>
        {mode === 'desktop' ? (
          <IconButton label="Скрыть панель" side="right" className="text-muted-foreground" onClick={onClose}>
            <PanelLeftClose className="size-[18px]" aria-hidden />
          </IconButton>
        ) : (
          <IconButton label="Закрыть меню" className="text-muted-foreground" onClick={onClose}>
            <X className="size-[18px]" aria-hidden />
          </IconButton>
        )}
      </div>

      <div className="px-2">
        <button
          type="button"
          onClick={() => {
            newChat()
            afterNavigate()
          }}
          className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <SquarePen className="size-4" aria-hidden />
          Новый чат
        </button>
      </div>

      <nav className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Чаты и документы">
        <section aria-labelledby="chats-heading">
          <h2 id="chats-heading" className="flex h-8 items-center px-2 text-xs font-medium text-muted-foreground">
            Чаты
          </h2>
          {threads.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Здесь появятся ваши чаты.</p>
          ) : (
            <ul className="flex flex-col gap-px">
              {threads.map((t) => {
                const active = t.id === threadId
                return (
                  <li key={t.id} className="group relative">
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        selectThread(t.id)
                        afterNavigate()
                      }}
                      title={t.title}
                      className={cn(
                        'flex h-9 w-full items-center rounded-lg pr-9 pl-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        active
                          ? 'bg-brand-soft font-medium text-brand-text'
                          : 'text-foreground hover:bg-muted',
                      )}
                    >
                      <span className="truncate">{t.title}</span>
                    </button>
                    <IconButton
                      label="Убрать чат из списка"
                      side="right"
                      size="icon-xs"
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      onClick={() => forgetThread(t.id)}
                    >
                      <X aria-hidden />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <Documents />
      </nav>

      <div className="shrink-0 border-t px-2 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <ThemeSwitch />
      </div>
    </div>
  )
}
