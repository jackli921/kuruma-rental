import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { OperatorInboxView, threadsQueryOptions } from '@/vite/messaging'
import { useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute } from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator inbox (#1205 slice 3). Gated by `_business` (business role) + the
// `manage/messages` visibility layer. The `/threads` endpoint scopes to the
// caller's tenant server-side (#1205 slice 2), so the operator and renter share
// the same query/cache — opening a thread marks it read and re-derives the badge.
export const Route = createFileRoute('/$locale/_business/manage/messages/')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(threadsQueryOptions())
  },
  pendingComponent: PageSkeleton,
  errorComponent: MessagesError,
  component: OperatorMessagesRoute,
})

function OperatorMessagesRoute() {
  const t = useTranslations('messaging.threadList')
  const { locale } = Route.useParams()
  const { data: threads } = useSuspenseQuery(threadsQueryOptions())

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <OperatorInboxView threads={threads} locale={locale} />
      </div>
    </main>
  )
}

function MessagesError(_props: ErrorComponentProps) {
  const t = useTranslations('messaging.threadList')

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <RouteRetryError
        message={t('loadError')}
        retryLabel={t('retry')}
        className="mx-auto max-w-3xl py-20 text-center"
      />
    </main>
  )
}
