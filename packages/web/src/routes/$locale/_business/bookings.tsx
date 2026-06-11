import { PageSkeleton } from '@/vite/PageSkeleton'
import { OperatorBookingsView } from '@/vite/operator-bookings/OperatorBookingsView'
import { operatorBookingsQueryOptions } from '@/vite/operator-bookings/api'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator booking list (#512). Lives under the `_business` guard, so only
// business roles reach it; tenant scoping is server-side (CallerContext), the
// client passes no operatorId. The loader prefetches into the query cache (no
// FOUC); the component reads the same options via useSuspenseQuery.
export const Route = createFileRoute('/$locale/_business/bookings')({
  loader: ({ context }) => context.queryClient.ensureQueryData(operatorBookingsQueryOptions()),
  pendingComponent: PageSkeleton,
  errorComponent: OperatorBookingsError,
  component: OperatorBookingsRoute,
})

function OperatorBookingsRoute() {
  const t = useTranslations('bookings.operator')
  const { locale } = Route.useParams()
  const { data: bookings } = useSuspenseQuery(operatorBookingsQueryOptions())

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorBookingsView bookings={bookings} locale={locale} />
      </div>
    </main>
  )
}

function OperatorBookingsError(_props: ErrorComponentProps) {
  const t = useTranslations('bookings.operator')
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl py-20 text-center">
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
