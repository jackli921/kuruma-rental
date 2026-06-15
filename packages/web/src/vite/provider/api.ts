import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { z } from 'zod'

/** Public invite preview (#521 §7). Carries no email — only enough to render the
 *  acceptance page. `expiresAt` is the JSON-serialized ISO string; the API never
 *  exposes the invited address. `valid` gates the accept CTA. Inferred from the
 *  schema (#711) so the compile-time type and the runtime parse at the seam share
 *  one source. On an unknown/expired token the producer omits operatorName and
 *  expiresAt (a bare `{ valid: false }`), so both stay optional. */
const invitePreviewDataSchema = z.object({
  valid: z.boolean(),
  operatorName: z.string().optional(),
  expiresAt: z.string().optional(),
})

export type InvitePreviewData = z.infer<typeof invitePreviewDataSchema>

// Public endpoint — anonymous; the recipient has no session yet. Always a 200
// ok() envelope (an unknown/expired token is `{ valid: false }`, not a 404), so
// unwrap never throws on a normal miss.
export async function fetchInvitePreview(token: string): Promise<InvitePreviewData> {
  const res = await fetch(
    `${getApiBaseUrl()}/provider-invites/${encodeURIComponent(token)}/preview`,
    {
      credentials: 'include',
    },
  )
  return unwrap(res, invitePreviewDataSchema)
}
