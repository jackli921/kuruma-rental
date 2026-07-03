import { PageSkeleton } from '@/vite/PageSkeleton'
import { ConversationView, threadByIdQueryOptions } from '@/vite/messaging'
import { operatorBookingDetailQueryOptions } from '@/vite/operator-bookings/api'
import { RouteRetryError } from '@/vite/route-error'
import { sessionQueryOptions } from '@/vite/session'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  type ErrorComponentProps,
  Link,
  createFileRoute,
  notFound,
  redirect,
} from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Operator conversation view (#1205 slice 3). Gated by `_business` + the
// `manage/messages` visibility layer. The loader resolves the thread (404 ->
// notFound, tenant-sealed at the API) and warms the booking so the renter name +
// cancelled-composer state paint without a flash. Unlike the renter side it reads
// the booking via the operator detail endpoint (which carries the renter block).
export const Route = createFileRoute('/$locale/_business/manage/messages/$threadId')({
  loader: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    // The parent `_business` guard redirects an anonymous caller first; re-checking
    // keeps the loader's return type honest and is a defensive backstop.
    if (!session) {
      throw redirect({
        to: '/$locale/login',
        params: { locale: params.locale },
        search: { returnTo: location.pathname },
      })
    }
    const thread = await context.queryClient.ensureQueryData(
      threadByIdQueryOptions(params.threadId),
    )
    if (!thread) throw notFound()

    if (thread.bookingId) {
      await context.queryClient.ensureQueryData(operatorBookingDetailQueryOptions(thread.bookingId))
    }
    return { currentUserId: session.user.id, csrfToken: session.csrfToken }
  },
  pendingComponent: PageSkeleton,
  errorComponent: ThreadError,
  component: OperatorThreadRoute,
})

function OperatorThreadRoute() {
  const t = useTranslations('messaging.thread')
  const tList = useTranslations('messaging.threadList')
  const { locale, threadId } = Route.useParams()
  const { currentUserId, csrfToken } = Route.useLoaderData()
  const { data: thread } = useSuspenseQuery(threadByIdQueryOptions(threadId))

  // All hooks run unconditionally (optional-chained off `thread`) before the null
  // guard, so a poll resolving a since-deleted thread to null can't reorder hooks.
  const { data: booking } = useQuery({
    ...operatorBookingDetailQueryOptions(thread?.bookingId ?? ''),
    enabled: thread?.bookingId != null,
  })

  if (!thread) return null

  const counterpartName = booking?.renter?.name ?? tList('guest')
  const isCancelled = booking?.status === 'CANCELLED'

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link
            to="/$locale/manage/messages"
            params={{ locale }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t('back')}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{counterpartName}</h1>
        </header>
        <ConversationView
          threadId={threadId}
          currentUserId={currentUserId}
          messages={thread.messages}
          counterpartName={counterpartName}
          disabled={isCancelled}
          disabledReason={t('cancelled')}
          csrfToken={csrfToken}
          locale={locale}
        />
      </div>
    </main>
  )
}

function ThreadError(_props: ErrorComponentProps) {
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
