import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type ThemeSetting = 'light' | 'dark' | 'system'

const KEY = 'rag.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'
const listeners = new Set<() => void>()

function readSetting(): ThemeSetting {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    // storage unavailable: follow the system
  }
  return 'system'
}

let current: ThemeSetting = readSetting()

function systemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

export function resolveTheme(setting: ThemeSetting): 'light' | 'dark' {
  if (setting === 'system') return systemDark() ? 'dark' : 'light'
  return setting
}

function apply(setting: ThemeSetting) {
  document.documentElement.classList.toggle('dark', resolveTheme(setting) === 'dark')
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Theme setting (light / dark / system) persisted in localStorage, shared by all callers. */
export function useTheme() {
  const setting = useSyncExternalStore(subscribe, () => current)

  useEffect(() => {
    apply(setting)
    if (setting !== 'system' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      apply('system')
      listeners.forEach((l) => l())
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [setting])

  const setTheme = useCallback((next: ThemeSetting) => {
    current = next
    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      // storage unavailable: the choice lasts for this session only
    }
    listeners.forEach((l) => l())
  }, [])

  return { theme: setting, resolved: resolveTheme(setting), setTheme }
}
