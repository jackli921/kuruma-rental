import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { FeatureFlagsView, setFeatureFlag } from '@/vite/admin/feature-flags'
import { featureFlagsQueryOptions, resolveFeatureFlag } from '@/vite/config'
import { useSession } from '@/vite/session'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
} from '@kuruma/shared/feature-flags/registry'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-admin runtime feature-flag switchboard. The `_admin` parent layout
// already gates on platform-admin membership; this route owns the read + the
// toggle write. Reads reuse featureFlagsQueryOptions() (the ['feature-flags'] key
// the app-wide FeatureFlagsProvider subscribes to), so a successful PATCH +
// invalidation flips the live UI on the owner's own client immediately.
export const Route = createFileRoute('/$locale/_admin/admin/feature-flags/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(featureFlagsQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: FeatureFlagsError,
  component: FeatureFlagsRoute,
})

function FeatureFlagsRoute() {
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''
  const { data: overrides } = useQuery(featureFlagsQueryOptions())

  const mutation = useMutation({
    mutationFn: (input: { key: FeatureFlagKey; enabled: boolean }) =>
      setFeatureFlag({ ...input, csrfToken }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: featureFlagsQueryOptions().queryKey }),
  })

  const map = overrides ?? {}
  const rows = FEATURE_FLAG_KEYS.map((key) => ({
    key,
    label: FEATURE_FLAGS[key].label,
    effective: resolveFeatureFlag(map, key),
    overridden: map[key] !== undefined,
    runtimeControlled: FEATURE_FLAGS[key].runtimeControlled,
  }))

  const pendingKey = mutation.isPending ? (mutation.variables?.key ?? null) : null

  return (
    <FeatureFlagsView
      rows={rows}
      pendingKey={pendingKey}
      onToggle={(key, enabled) => mutation.mutate({ key, enabled })}
    />
  )
}

function FeatureFlagsError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.featureFlags')
  return (
    <RouteRetryError
      message={t('loadError')}
      retryLabel={t('retry')}
      className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8"
    />
  )
}
