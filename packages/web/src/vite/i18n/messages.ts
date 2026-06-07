import { queryOptions } from '@tanstack/react-query'
import type { AbstractIntlMessages } from 'use-intl'
import type { Locale } from './locale'

/**
 * Fetch a locale's ICU messages from the same-origin static path. On CF Pages
 * these are copied into the build (vite.config.mts messages plugin) and served
 * by Pages; in dev the same plugin serves them from `messages/`.
 */
export async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const response = await fetch(`/messages/${locale}.json`)
  if (!response.ok) {
    throw new Error(`Failed to load messages for "${locale}": ${response.status}`)
  }
  return (await response.json()) as AbstractIntlMessages
}

// Cached forever: messages are immutable per build. Active locale is prefetched in
// the $locale route loader; other locales load lazily on switch (spec §6.2).
export function messagesQueryOptions(locale: Locale) {
  return queryOptions({
    queryKey: ['messages', locale],
    queryFn: () => loadMessages(locale),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}
