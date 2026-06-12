import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'

/** Public invite preview (#521 §7). Carries no email — only enough to render the
 *  acceptance page. `expiresAt` is the JSON-serialized ISO string; the API never
 *  exposes the invited address. `valid` gates the accept CTA. */
export interface InvitePreviewData {
  valid: boolean
  operatorName?: string
  expiresAt?: string
}

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
  return unwrap<InvitePreviewData>(res)
}
