import { PageSkeleton } from '@/vite/PageSkeleton'
import { FeatureFlagsView, setFeatureFlag } from '@/vite/admin/feature-flags'
import { featureFlagsQueryOptions, isBuildTimeEnabled } from '@/vite/config'
import { useSession } from '@/vite/session'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
} from '@kuruma/shared/feature-flags/registry'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
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
    effective: map[key] ?? isBuildTimeEnabled(key),
    overridden: map[key] !== undefined,
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
  const router = useRouter()
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
      <p className="text-lg text-muted-foreground">{t('loadError')}</p>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 font-medium text-sm hover:bg-muted/50"
      >
        {t('retry')}
      </button>
    </div>
  )
}
