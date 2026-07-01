import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { FeatureFlagKey } from '@kuruma/shared/feature-flags/registry'
import { z } from 'zod'

// Web-side write for the platform-admin runtime feature-flag toggles. Reads reuse
// `featureFlagsQueryOptions()` from `@/vite/config` (the same ['feature-flags']
// key the app-wide provider subscribes to), so a successful PATCH + invalidation
// updates both this page and every live gate on the owner's client at once.
const writeAckSchema = z.object({ key: z.string(), enabled: z.boolean() })

export async function setFeatureFlag(params: {
  key: FeatureFlagKey
  enabled: boolean
  csrfToken: string
}): Promise<void> {
  const { key, enabled, csrfToken } = params
  const res = await fetch(`${getApiBaseUrl()}/admin/feature-flags/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ enabled }),
  })
  await unwrap(res, writeAckSchema)
}
