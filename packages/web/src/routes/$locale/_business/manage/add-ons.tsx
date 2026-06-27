import { PageSkeleton } from '@/vite/PageSkeleton'
import { canWriteAsOperator, isCrossOperatorReader } from '@/vite/guards'
import { OperatorAddOnsView } from '@/vite/operator-add-ons/OperatorAddOnsView'
import { addOnsQueryOptions } from '@/vite/operator-add-ons/api'
import { operatorsQueryOptions, useOperatorContext } from '@/vite/operator-context'
import { useSession } from '@/vite/session'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslations } from 'use-intl'

// Operator add-on management (#585). URL `/<locale>/manage/add-ons` — behind the
// `_business` guard, so only business roles reach it. Tenant scoping is server-side
// (CallerContext): an operator session auto-scopes; a cross-operator reader sees all
// tenants (read-only); a platform admin who has picked a tenant via the operator
// context picker scopes to it and may write. The `operator` search param (read via
// loaderDeps so a context switch refetches) selects the picked tenant; the loader
// prefetches that scoped list into the cache (no FOUC) and the component reads it back.
export const Route = createFileRoute('/$locale/_business/manage/add-ons')({
  loaderDeps: ({ search }: { search: { operator?: string | undefined } }) => ({
    operator: search.operator,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(addOnsQueryOptions(deps.operator)),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorAddOnsError,
  component: OperatorAddOnsRoute,
})

function OperatorAddOnsRoute() {
  const t = useTranslations('business.addOns')
  const { pickedOperatorId } = useOperatorContext()
  const { data: session } = useSession()
  const { data: addOns } = useSuspenseQuery(addOnsQueryOptions(pickedOperatorId))

  // Operator labels + the /operators fetch are for cross-operator readers in all-mode
  // ONLY. A scoped operator session never reads cross-tenant (no labels, no fetch); a
  // picked tenant is already single-tenant. Gating on isCrossOperatorReader (not just
  // !pickedOperatorId) keeps a normal operator's experience unchanged (non-goal §).
  const showOperator = isCrossOperatorReader(session ?? null) && !pickedOperatorId
  const { data: operators } = useQuery({ ...operatorsQueryOptions(), enabled: showOperator })
  const canWrite = canWriteAsOperator(session ?? null, pickedOperatorId)
  const operatorNameById = useMemo(
    () => new Map((operators ?? []).map((o) => [o.id, o.name])),
    [operators],
  )

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorAddOnsView
          addOns={addOns}
          canWrite={canWrite}
          showOperator={showOperator}
          operatorNameById={operatorNameById}
          pickedOperatorId={pickedOperatorId}
        />
      </div>
    </main>
  )
}

function OperatorAddOnsError(_props: ErrorComponentProps) {
  const t = useTranslations('business.addOns')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl py-20 text-center">
        <p className="text-lg text-muted-foreground">{t('loadError')}</p>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          {t('retry')}
        </button>
      </div>
    </main>
  )
}
