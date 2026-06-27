import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { PendingConsent } from '@/vite/consent/types'
import { CONSENT_TYPES } from '@kuruma/shared/enums'
import { z } from 'zod'

// #877 Flow A clickwrap client. Cookie-based, same shape as the other Vite API
// clients (no hono-client/Bearer copy). The status list and the identity behind
// `accept` are session-scoped server-side, so this client passes no userId.

// Validate `data` at the network seam (#711 unwrap-schema ratchet). The document
// is narrowed to the fields the gate shows; the wire's extra columns (version,
// contentHash, dates, …) are stripped by the non-strict object. There is no
// compile-time link to the API's ConsentDocument across the package boundary (web
// imports no api types by rule), so this schema IS the contract: a producer-side
// rename surfaces here as a ParseError at runtime, not silently as undefined in
// render (#1036 L1).
const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  acceptanceLabel: z.string(),
})
const pendingConsentSchema = z.object({
  type: z.enum(CONSENT_TYPES),
  document: documentSchema,
}) satisfies z.ZodType<PendingConsent>

// The acceptance receipt — we only need to know the write landed; the gate then
// refetches status to learn the subject is current.
const acceptanceSchema = z.object({ id: z.string() })

export async function fetchConsentStatus(locale: string): Promise<PendingConsent[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/consent/status?locale=${encodeURIComponent(locale)}`,
    { credentials: 'include' },
  )
  return unwrap(res, pendingConsentSchema.array())
}

// CSRF-gated like every cookie-authed mutation (middleware/csrf.ts) — thread the
// session's token in X-CSRF-Token. Throws ApiError on failure for useMutation.
export async function acceptConsent(documentId: string, csrfToken: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/consent/accept`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ documentId }),
  })
  await unwrap(res, acceptanceSchema)
}
