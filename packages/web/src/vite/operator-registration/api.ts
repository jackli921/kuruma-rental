import { ApiError, unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
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
export { ApiError }
