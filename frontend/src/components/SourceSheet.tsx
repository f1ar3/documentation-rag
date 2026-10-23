import { useState } from 'react'
import { FileText } from 'lucide-react'
import { sameSource, sourceLabel } from '@/lib/citations'
import { cn } from '@/lib/utils'
import type { Source } from '@/lib/types'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { uniqueSources } from './sources'

export type SourceSelection = { source: Source; answerSources: Source[] }

function placeText(src: Source): string {
  if (src.page !== null) return `Страница ${src.page}`
  if (src.section !== null) return `Раздел «${src.section}»`
  return 'Документ целиком, без страниц и разделов'
}

export function SourceSheet({
  selection,
  onSelect,
  onClose,
}: {
  selection: SourceSelection | null
  onSelect(source: Source): void
  onClose(): void
}) {
  // Keep the last selection so the sheet does not slide out empty during its close animation
  // (state adjusted during render, same idea as the delete dialog in Documents).
  const [shown, setShown] = useState<SourceSelection | null>(selection)
  if (selection !== null && selection !== shown) setShown(selection)
  const src = shown?.source
  const sameFile = shown
    ? uniqueSources(shown.answerSources).filter((s) => s.source === shown.source.source)
    : []

  return (
    <Sheet open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {src && (
          <>
            <SheetHeader className="border-b px-5 pt-5 pb-4 pr-12">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <FileText className="size-[18px]" aria-hidden />
                </span>
                <div className="min-w-0">
                  <SheetTitle className="text-base leading-snug font-semibold break-words">
                    {src.source}
                  </SheetTitle>
                  <SheetDescription className="mt-0.5">Источник ответа</SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <h3 className="text-xs font-medium text-muted-foreground">Место в документе</h3>
              <p className="mt-1.5 text-[15px] text-foreground">{placeText(src)}</p>

              <h3 className="mt-7 text-xs font-medium text-muted-foreground">
                Все ссылки ответа на этот файл
              </h3>
              <ul className="mt-2 flex flex-col gap-1">
                {sameFile.map((s) => {
                  const active = sameSource(s, src)
                  return (
                    <li key={sourceLabel(s)}>
                      <button
                        type="button"
                        aria-current={active || undefined}
                        onClick={() => onSelect(s)}
                        className={cn(
                          'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          active
                            ? 'bg-brand-soft font-medium text-brand-text'
                            : 'text-foreground hover:bg-muted',
                        )}
                      >
                        {placeText(s)}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {sameFile.length <= 1 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Других ссылок на этот файл в ответе нет.
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
