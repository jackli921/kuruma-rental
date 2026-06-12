import { detectBrowserLocale } from '@/vite/i18n/detectBrowserLocale'
import { createFileRoute, redirect } from '@tanstack/react-router'

// `/` -> detected locale. Canonical detection is detectLocale (tested) behind the
// detectBrowserLocale shell; the inline script in index.html only sets <html lang>
// early for pre-paint a11y (spec §6.2).
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/$locale', params: { locale: detectBrowserLocale() } })
  },
})
