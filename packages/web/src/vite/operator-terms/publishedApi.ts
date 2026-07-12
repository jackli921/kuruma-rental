import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #877 Slice B: the renter-facing read of an operator's PUBLISHED rental terms.
// Distinct from the authoring client (`./api.ts`, fleet-write-only) — this hits
// the renter-safe `GET /operator-terms/published` (auth-only, flag-gated dark on
// the server: 404 when OPERATOR_TERMS is off). The booking-create modal renders
// the returned title/body and PINS `version` back on submit so display and the
// signed acceptance can't drift.
export const publishedOperatorTermsSchema = z.object({
  version: z.string(),
  locale: z.string(),
  title: z.string(),
  body: z.string(),
  acceptanceLabel: z.string(),
  contentHash: z.string(),
})
export type PublishedOperatorTerms = z.infer<typeof publishedOperatorTermsSchema>

// 404 (no published doc, OR the server flag is off) maps to null so the caller
// treats "no terms to accept" as a plain absence, not an error — the booking then
// submits without the pin fields and the server require-branch skips.
export async function fetchPublishedOperatorTerms(
  operatorId: string,
  locale: string,
): Promise<PublishedOperatorTerms | null> {
  const res = await fetch(
    `${getApiBaseUrl()}/operator-terms/published?operatorId=${encodeURIComponent(operatorId)}&locale=${encodeURIComponent(locale)}`,
    { credentials: 'include' },
  )
  if (res.status === 404) return null
  return unwrap(res, publishedOperatorTermsSchema)
}

export function publishedOperatorTermsQueryOptions(operatorId: string, locale: string) {
  return queryOptions({
    queryKey: ['operator-terms', 'published', operatorId, locale] as const,
    queryFn: () => fetchPublishedOperatorTerms(operatorId, locale),
  })
}
