// Locale model for the Vite/CF Pages shell (#378, spec §4.1/§6). Mirrors the
// frozen next-intl routing (en/ja/zh, default en) without importing next-intl.
export const LOCALES = ['en', 'ja', 'zh'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

// Reused from the Next era (razor line 129) so an existing visitor's choice carries over.
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && (LOCALES as readonly string[]).includes(value)
}

/**
 * Resolve the active locale (spec §6.2): a valid NEXT_LOCALE cookie wins, else the
 * first navigator language whose base prefix is supported, else the default.
 */
export function detectLocale(input: {
  cookie?: string | null
  languages?: readonly string[]
}): Locale {
  if (isLocale(input.cookie)) return input.cookie
  for (const language of input.languages ?? []) {
    const prefix = language.split('-')[0]?.toLowerCase()
    if (isLocale(prefix)) return prefix
  }
  return DEFAULT_LOCALE
}
