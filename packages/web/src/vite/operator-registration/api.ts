import { ApiError, unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Public operator-registration endpoint (#1277). The result schema anchors to
// `PENDING` because a fresh application is always pending — validating `data`
// at the seam satisfies the lint:unwrap-schema CI gate.
const resultSchema = z.object({ id: z.string(), status: z.literal('PENDING') })
export type OperatorApplicationResult = z.infer<typeof resultSchema>

// Submit a new operator application. Sign-in-first (#877): the endpoint is authed —
// it derives the authoritative applicant email + id from the session, so `input`
// carries no email. As a cookie-authenticated POST it is CSRF-gated, so the caller
// echoes the session CSRF token in the `X-CSRF-Token` header (never the body).
export async function submitOperatorApplication(
  input: OperatorApplicationInput,
  csrfToken: string,
): Promise<OperatorApplicationResult> {
  const res = await fetch(`${getApiBaseUrl()}/operator-applications`, {
    method: 'POST',
    credentials: 'include', // authed endpoint: send the session cookie
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(input),
  })
  return unwrap(res, resultSchema)
}
// Applicant's own application status (#1549). Returns the public-facing row
// (id, status, businessName, operatorId, rejectionReason) or null when the
// caller has no application (404). The schema is non-strict: the wire may carry
// server-only fields that are stripped by zod so they never reach the client.
const myApplicationSchema = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  businessName: z.string(),
  operatorId: z.string().nullable(),
  rejectionReason: z.string().nullable(),
})
export type MyApplication = z.infer<typeof myApplicationSchema>

export async function getMyApplication(): Promise<MyApplication | null> {
  const res = await fetch(`${getApiBaseUrl()}/operator-applications/me`, {
    credentials: 'include',
  })
  if (res.status === 404) return null
  return unwrap(res, myApplicationSchema)
}

export function myApplicationQueryOptions() {
  return queryOptions({ queryKey: ['operator-applications', 'me'], queryFn: getMyApplication })
}

export { ApiError }
