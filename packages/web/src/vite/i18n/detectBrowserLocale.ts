import { LOCALE_COOKIE, type Locale, detectLocale } from '@/vite/i18n/locale'

function readCookie(name: string): string | null {
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=')
    if (eq !== -1 && part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1))
    }
  }
  return null
}

/** Browser shell over the pure `detectLocale` (FC/IS): reads the NEXT_LOCALE
 *  cookie + navigator languages from the DOM, then delegates the decision to the
 *  pure core. Shared by the `/` redirect and the locale-free invite-link redirect. */
export function detectBrowserLocale(): Locale {
  return detectLocale({ cookie: readCookie(LOCALE_COOKIE), languages: navigator.languages })
}
