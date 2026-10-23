import { RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ApiError } from '@/lib/api'

function describe(error: ApiError): { title: string; text: string } {
  // 502/504 with no JSON body come from the proxy (nginx / vite) when the backend is down.
  if (error.status === 0 || error.status === 502 || error.status === 504) {
    return { title: 'Нет связи с сервером', text: 'Проверьте, что backend запущен, и повторите попытку.' }
  }
  if (error.message.includes('GOOGLE_API_KEY')) {
    return {
      title: 'Сервер не настроен',
      text: 'Не задан GOOGLE_API_KEY. Добавьте ключ в файл .env и перезапустите приложение.',
    }
  }
  return { title: 'Сервер недоступен', text: error.message }
}

export function ConnectionBanner({ error, onRetry }: { error: ApiError; onRetry(): void }) {
  const { title, text } = describe(error)
  return (
    <div className="shrink-0 px-3 pt-1 sm:px-4">
      <div
        role="alert"
        className="mx-auto flex w-full max-w-[720px] items-start gap-3 rounded-xl border bg-muted/60 px-4 py-3 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-muted-foreground">{text}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
          <RotateCw aria-hidden />
          Повторить
        </Button>
      </div>
    </div>
  )
}
