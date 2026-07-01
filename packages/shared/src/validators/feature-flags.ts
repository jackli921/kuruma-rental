import { z } from 'zod'

// Body for PATCH /admin/feature-flags/:key. The :key path param is validated
// separately against FEATURE_FLAG_KEYS (isFeatureFlagKey) at the route.
export const setFeatureFlagSchema = z.object({
  enabled: z.boolean(),
})

export type SetFeatureFlagInput = z.infer<typeof setFeatureFlagSchema>
