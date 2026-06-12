import { PageSkeleton } from '@/vite/PageSkeleton'
import { OperatorInsuranceView } from '@/vite/operator-insurance/OperatorInsuranceView'
import { insuranceOptionsQueryOptions } from '@/vite/operator-insurance/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator insurance-option management (#530). URL `/<locale>/manage/insurance`
// — behind the `_business` guard, so only business roles reach it; tenant
// scoping is server-side (CallerContext), the client passes no operatorId. The
// loader prefetches into the query cache (no FOUC); the component reads the same
// options via useSuspenseQuery and the CRUD dialogs invalidate the shared key.
export const Route = createFileRoute('/$locale/_business/manage/insurance')({
  loader: ({ context }) => context.queryClient.ensureQueryData(insuranceOptionsQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorInsuranceError,
  component: OperatorInsuranceRoute,
})

function OperatorInsuranceRoute() {
  const t = useTranslations('business.insurance')
  const { data: options } = useSuspenseQuery(insuranceOptionsQueryOptions())

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorInsuranceView options={options} />
      </div>
    </main>
  )
}

function OperatorInsuranceError(_props: ErrorComponentProps) {
  const t = useTranslations('business.insurance')
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
