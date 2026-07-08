import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { TemplateLibraryView, templateLibraryQueryOptions } from '@/vite/admin/template-library'
import { featureFlagsQueryOptions, resolveFeatureFlag } from '@/vite/config'
import { useQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-admin template library (#1319). The `_admin` parent layout already
// gates on platform-admin membership, so this owns only the data — prefetch both
// catalogs and render the tabbed table. Slice 2 adds per-row translate + promote
// (via the view's edit dialog); create + merge synonyms lands in slice 3.
export const Route = createFileRoute('/$locale/_admin/admin/templates')({
  // The shared catalog is a platform-wide kill-switch (#1437, owner decision D3):
  // when SHARED_CATALOG is off the whole template surface is "fully hidden", not just
  // the sidebar link. Gate the route itself so it can't be reached by direct URL — no
  // admin bypass (unlike the messaging dark-launch), because switching the shared
  // catalog off is a deliberate platform decision, not a beta preview. SHARED_CATALOG is
  // serverOnly + serverDefault ON, so the default admits and only an override closes it.
  beforeLoad: async ({ context, params }) => {
    // fetchQuery (not ensureQueryData) so the kill-switch honors an override on a hard
    // load, not the seeded default (#1486); fetchFeatureFlagOverrides is fail-safe.
    const overrides = await context.queryClient.fetchQuery(featureFlagsQueryOptions())
    if (!resolveFeatureFlag(overrides, 'SHARED_CATALOG')) {
      throw redirect({ to: '/$locale/admin', params: { locale: params.locale } })
    }
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(templateLibraryQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: TemplateLibraryError,
  component: TemplateLibraryRoute,
})

function TemplateLibraryRoute() {
  const { data, isPending } = useQuery(templateLibraryQueryOptions())

  if (!data) return isPending ? <PageSkeleton /> : null
  return <TemplateLibraryView addOns={data.addOns} insurance={data.insurance} />
}

function TemplateLibraryError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.templateLibrary')
  return (
    <RouteRetryError
      message={t('loadError')}
      retryLabel={t('retry')}
      className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8"
    />
  )
}
