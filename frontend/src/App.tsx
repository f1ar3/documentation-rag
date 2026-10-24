import { useCallback, useEffect, useState } from 'react'
import { Menu, PanelLeftOpen, SquarePen } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Chat } from '@/components/Chat'
import { ConnectionBanner } from '@/components/ConnectionBanner'
import { IconButton } from '@/components/IconButton'
import { Sidebar } from '@/components/Sidebar'
import { useWindowFileDrop } from '@/hooks/use-file-drop'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import type { DocumentContent, DocumentInfo } from '@/lib/types'
import { ChatProvider, useChat } from '@/state/chat'
import type { UiMessage } from '@/state/chat'
import { DocumentsProvider, useDocuments } from '@/state/documents'
import { ViewerProvider } from '@/state/viewer'
import type { OpenDocumentOptions } from '@/state/viewer'

const SIDEBAR_KEY = 'rag.sidebar'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 transition-opacity duration-150 motion-reduce:transition-none sm:p-6',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand/50 text-center">
        <p className="text-lg font-medium text-foreground">Отпустите, чтобы загрузить</p>
        <p className="mt-1 text-sm text-muted-foreground">PDF, DOCX, MD или TXT</p>
      </div>
    </div>
  )
}

function Shell() {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { newChat, threads, threadId, reloadHistory } = useChat()
  const { upload, loadError, reload } = useDocuments()

  const dragging = useWindowFileDrop(
    useCallback((files: File[]) => void upload(files), [upload]),
  )

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open')
    } catch {
      // storage unavailable: the state is not remembered
    }
  }, [collapsed])

  // Leaving the phone layout closes the slide-over menu (state adjusted during render).
  if (isDesktop && mobileOpen) setMobileOpen(false)

  const title = threads.find((t) => t.id === threadId)?.title
  const sidebarHidden = !isDesktop || collapsed

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {isDesktop && (
        <aside
          inert={collapsed}
          aria-label="Боковая панель"
          className={cn(
            'shrink-0 overflow-hidden border-r bg-sidebar transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
            collapsed ? 'w-0 border-r-0' : 'w-[272px]',
          )}
        >
          <div className="h-full w-[272px]">
            <Sidebar mode="desktop" onClose={() => setCollapsed(true)} />
          </div>
        </aside>
      )}
      {!isDesktop && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" showCloseButton={false} className="gap-0 border-r-0 p-0 data-[side=left]:w-[86%] data-[side=left]:max-w-[300px]">
            <SheetTitle className="sr-only">Меню</SheetTitle>
            <Sidebar mode="mobile" onClose={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 px-2">
          {!isDesktop && (
            <IconButton label="Открыть меню" className="text-muted-foreground" onClick={() => setMobileOpen(true)}>
              <Menu className="size-[18px]" aria-hidden />
            </IconButton>
          )}
          {isDesktop && collapsed && (
            <IconButton label="Показать панель" side="right" className="text-muted-foreground" onClick={() => setCollapsed(false)}>
              <PanelLeftOpen className="size-[18px]" aria-hidden />
            </IconButton>
          )}
          {sidebarHidden && (
            <IconButton label="Новый чат" className="text-muted-foreground" onClick={newChat}>
              <SquarePen className="size-[18px]" aria-hidden />
            </IconButton>
          )}
          <div className={cn('min-w-0 flex-1 truncate text-sm text-muted-foreground', sidebarHidden ? 'px-1' : 'px-3')}>
            {title ?? (sidebarHidden ? 'Регламенты' : '')}
          </div>
        </header>
        {loadError && (
          <ConnectionBanner
            error={loadError}
            onRetry={() => {
              reload()
              reloadHistory()
            }}
          />
        )}
        <Chat />
      </main>

      <DropOverlay visible={dragging} />
      <Toaster position="top-center" />
    </div>
  )
}

export default function App({
  demo,
}: {
  /** Dev-only mock data (`?demo=1`), never passed in production. */
  demo?: {
    messages: UiMessage[]
    documents: DocumentInfo[]
    loadDocument?: (name: string) => Promise<DocumentContent>
    view?: { name: string } & OpenDocumentOptions
  }
}) {
  return (
    <TooltipProvider delay={500}>
      <ViewerProvider load={demo?.loadDocument} initial={demo?.view}>
        <DocumentsProvider initialDocuments={demo?.documents}>
          <ChatProvider initialMessages={demo?.messages}>
            <Shell />
          </ChatProvider>
        </DocumentsProvider>
      </ViewerProvider>
    </TooltipProvider>
  )
}
