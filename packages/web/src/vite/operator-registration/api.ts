import { ApiError, unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { OperatorApplicationInput } from '@kuruma/shared/validators/operator-application'
import { z } from 'zod'

// Public operator-registration endpoint (#1277). The result schema anchors to
// `PENDING` because a fresh application is always pending — validating `data`
// at the seam satisfies the lint:unwrap-schema CI gate.
const resultSchema = z.object({ id: z.string(), status: z.literal('PENDING') })
export type OperatorApplicationResult = z.infer<typeof resultSchema>

// Submit a new operator application.
export async function submitOperatorApplication(
  input: OperatorApplicationInput,
): Promise<OperatorApplicationResult> {
  const res = await fetch(`${getApiBaseUrl()}/operator-applications`, {
    method: 'POST',
    credentials: 'omit', // public endpoint: never send the session cookie (CSRF 403 otherwise)
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return unwrap(res, resultSchema)
}
export { ApiError }
