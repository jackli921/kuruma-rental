import { PageSkeleton } from '@/vite/PageSkeleton'
import { TemplateLibraryView, templateLibraryQueryOptions } from '@/vite/admin/template-library'
import { useQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Platform-admin template library (#1319), slice 1: read-only. The `_admin` parent
// layout already gates on platform-admin membership, so this owns only the data —
// prefetch both catalogs and render the tabbed table. Curation (translate, promote,
// merge) lands in later slices.
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
