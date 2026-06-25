import { fetchConsentStatus } from '@/vite/consent/api'
import { queryOptions, useQuery } from '@tanstack/react-query'

/** Root key for every consent query — `invalidateQueries` after an acceptance. */
export const CONSENT_QUERY_KEY = ['consent'] as const

export function consentStatusQueryOptions(locale: string, enabled: boolean) {
  return queryOptions({
    queryKey: [...CONSENT_QUERY_KEY, 'status', locale],
    queryFn: () => fetchConsentStatus(locale),
    // Only renters can owe Flow A consent; never fire the request otherwise.
    enabled,
  })
}

export function usePendingConsents(locale: string, enabled: boolean) {
  return useQuery(consentStatusQueryOptions(locale, enabled))
}
