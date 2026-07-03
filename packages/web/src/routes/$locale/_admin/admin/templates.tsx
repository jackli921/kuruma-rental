import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { TemplateLibraryView, templateLibraryQueryOptions } from '@/vite/admin/template-library'
import { useQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-admin template library (#1319). The `_admin` parent layout already
// gates on platform-admin membership, so this owns only the data — prefetch both
// catalogs and render the tabbed table. Slice 2 adds per-row translate + promote
// (via the view's edit dialog); create + merge synonyms lands in slice 3.
export const Route = createFileRoute('/$locale/_admin/admin/templates')({
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
