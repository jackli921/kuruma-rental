import { PageSkeleton } from '@/vite/PageSkeleton'
import { ConsentGovernanceView } from '@/vite/admin/governance/ConsentGovernanceView'
import { consentAcceptancesQueryOptions } from '@/vite/admin/governance/api'
import {
  type ConsentGovernanceFilters,
  consentGovernanceFiltersSchema,
} from '@kuruma/shared/types/consent-governance'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// A drifted/invalid search (e.g. a hand-typed bad consentType) drops back to the
// unfiltered ledger rather than erroring; the server validates again anyway.
function validateSearch(search: Record<string, unknown>): ConsentGovernanceFilters {
  const parsed = consentGovernanceFiltersSchema.safeParse(search)
  return parsed.success ? parsed.data : {}
}

// Platform-admin consent-acceptance governance browse (#1091, epic #1075 slice 5).
// The `_admin` parent layout already gates on platform-admin membership, so this
// only owns the data: read the filter search params, prefetch in the loader, render
// the pure view and turn its filter callback into a URL navigation.
export const Route = createFileRoute('/$locale/_admin/admin/governance')({
  validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(consentAcceptancesQueryOptions(deps)),
  pendingComponent: PageSkeleton,
  errorComponent: GovernanceError,
  component: GovernanceRoute,
})

function GovernanceRoute() {
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data } = useSuspenseQuery(consentAcceptancesQueryOptions(filters))

  return (
    <ConsentGovernanceView
      acceptances={data.acceptances}
      filters={filters}
      onApplyFilters={(next) => navigate({ search: () => next })}
    />
  )
}

function GovernanceError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.governance')
  const router = useRouter()
  return (
    <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 lg:px-8">
      <p className="text-lg text-muted-foreground">{t('loadError')}</p>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
      >
        {t('retry')}
      </button>
    </div>
  )
}
