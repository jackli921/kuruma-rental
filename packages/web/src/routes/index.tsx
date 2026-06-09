import { LOCALE_COOKIE, detectLocale } from '@/vite/i18n/locale'
import { createFileRoute, redirect } from '@tanstack/react-router'

function readCookie(name: string): string | null {
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1))
    }
  }
  return null
}

// `/` -> detected locale. Canonical detection is detectLocale (tested); the inline
// script in index.html only sets <html lang> early for pre-paint a11y (spec §6.2).
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const locale = detectLocale({
      cookie: readCookie(LOCALE_COOKIE),
      languages: navigator.languages,
    })
    throw redirect({ to: '/$locale', params: { locale } })
  },
})
