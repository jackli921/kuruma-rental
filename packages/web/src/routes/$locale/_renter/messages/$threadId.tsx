import { PageSkeleton } from '@/vite/PageSkeleton'
import { bookingByIdQueryOptions } from '@/vite/bookings/api'
import { ConversationView } from '@/vite/messaging/ConversationView'
import { threadByIdQueryOptions, usersByIdsQueryOptions } from '@/vite/messaging/api'
import { sessionQueryOptions } from '@/vite/session'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  type ErrorComponentProps,
  Link,
  createFileRoute,
  notFound,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useTranslations } from 'use-intl'

// Conversation view (#1032). Gated by `_renter`. The loader guards the session,
// resolves the thread (404 -> notFound, IDOR-safe at the API), and warms the
// counterpart name + (if present) the booking so the cancelled-composer state
// paints without a flash. The component reads the same caches via suspense/query
// (no FOUC) and hands the resolved data to ConversationView. Mirrors the storefront
// drill-down + My Bookings routes.
export const Route = createFileRoute('/$locale/_renter/messages/$threadId')({
  loader: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    // The parent `_renter` guard redirects an anonymous caller first; re-checking
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

    const counterpartId = thread.participants.find((p) => p.userId !== session.user.id)?.userId
    await Promise.all([
      counterpartId
        ? context.queryClient.ensureQueryData(usersByIdsQueryOptions([counterpartId]))
        : undefined,
      thread.bookingId
        ? context.queryClient.ensureQueryData(bookingByIdQueryOptions(thread.bookingId))
        : undefined,
    ])
    return { currentUserId: session.user.id, csrfToken: session.csrfToken }
  },
  pendingComponent: PageSkeleton,
  errorComponent: ThreadError,
  component: ThreadRoute,
})

function ThreadRoute() {
  const t = useTranslations('messaging.thread')
  const tList = useTranslations('messaging.threadList')
  const { locale, threadId } = Route.useParams()
  const { currentUserId, csrfToken } = Route.useLoaderData()
  const { data: thread } = useSuspenseQuery(threadByIdQueryOptions(threadId))

  // All hooks run unconditionally (optional-chained off `thread`) before the
  // null guard, so a poll that resolves a since-deleted thread to null can't
  // reorder the hook list.
  const counterpartId = thread?.participants.find((p) => p.userId !== currentUserId)?.userId
  const { data: users } = useQuery(usersByIdsQueryOptions(counterpartId ? [counterpartId] : []))
  const { data: booking } = useQuery({
    ...bookingByIdQueryOptions(thread?.bookingId ?? ''),
    enabled: thread?.bookingId != null,
  })

  if (!thread) return null

  const counterpartName = users?.[0]?.name ?? tList('host')
  const isCancelled = booking?.status === 'CANCELLED'

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link
            to="/$locale/messages"
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
  const router = useRouter()

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl py-20 text-center">
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
