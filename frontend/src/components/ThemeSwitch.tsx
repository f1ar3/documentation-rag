import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/use-theme'
import type { ThemeSetting } from '@/hooks/use-theme'

const OPTIONS: { value: ThemeSetting; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Светлая тема', icon: Sun },
  { value: 'dark', label: 'Тёмная тема', icon: Moon },
  { value: 'system', label: 'Как в системе', icon: Monitor },
]

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="flex items-center justify-between gap-2 pl-2">
      <span className="text-xs text-muted-foreground">Тема</span>
      <div role="radiogroup" aria-label="Тема оформления" className="flex rounded-lg bg-muted p-0.5">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'flex size-7 items-center justify-center rounded-md pointer-coarse:size-10 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              theme === value
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  )
}
