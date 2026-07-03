import { PageSkeleton } from '@/vite/PageSkeleton'
import { RouteRetryError } from '@/vite/RouteRetryError'
import { ThreadListView, threadsQueryOptions, usersByIdsQueryOptions } from '@/vite/messaging'
import { sessionQueryOptions } from '@/vite/session'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslations } from 'use-intl'

// Renter inbox (#1032). Gated by `_renter` (session required). The loader reads
// the caller id from the cached session and prefetches their threads; the
// component reads the same options via useSuspenseQuery (no FOUC) and resolves
// counterpart names from the live thread list. Mirrors the My Bookings route.
export const Route = createFileRoute('/$locale/_renter/messages/')({
  loader: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    // The parent `_renter` guard redirects an anonymous caller before this runs;
    // re-checking keeps the type honest and is a defensive backstop.
    if (!session) {
      throw redirect({
        to: '/$locale/login',
        params: { locale: params.locale },
        search: { returnTo: location.pathname },
      })
    }
    await context.queryClient.ensureQueryData(threadsQueryOptions())
    return { currentUserId: session.user.id }
  },
  pendingComponent: PageSkeleton,
  errorComponent: MessagesError,
  component: MessagesRoute,
})

function MessagesRoute() {
  const t = useTranslations('messaging.threadList')
  const { locale } = Route.useParams()
  const { currentUserId } = Route.useLoaderData()
  const { data: threads } = useSuspenseQuery(threadsQueryOptions())

  // Every co-participant across the inbox — resolved to display names in one
  // batched call. Derived from the live threads so a polled-in thread's
  // counterpart is picked up without re-running the loader.
  const counterpartIds = useMemo(() => {
    const ids = new Set<string>()
    for (const thread of threads) {
      for (const p of thread.participants) {
        if (p.userId !== currentUserId) ids.add(p.userId)
      }
    }
    return [...ids]
  }, [threads, currentUserId])

  const { data: users } = useQuery(usersByIdsQueryOptions(counterpartIds))
  const namesById = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const u of users ?? []) map[u.id] = u.name
    return map
  }, [users])

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-lg text-muted-foreground">{t('subtitle')}</p>
        </header>
        <ThreadListView
          threads={threads}
          namesById={namesById}
          currentUserId={currentUserId}
          locale={locale}
        />
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
