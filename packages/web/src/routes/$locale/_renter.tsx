import { PageSkeleton } from '@/vite/PageSkeleton'
import { ConsentGate } from '@/vite/consent/ConsentGate'
import { renterGuard } from '@/vite/guards'
import { sessionQueryOptions } from '@/vite/session'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Renter layout guard (spec §4.3/§4.5): requires a session; the in-flight fetch is
// held behind PageSkeleton so no auth flash. Children (bookings, messages) port later.
export const Route = createFileRoute('/$locale/_renter')({
  beforeLoad: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (renterGuard(session).type === 'login') {
      throw redirect({
        to: '/$locale/login',
        params: { locale: params.locale },
        search: { returnTo: location.pathname },
      })
    }
  },
  pendingComponent: PageSkeleton,
  component: RenterLayout,
})

// Clickwrap gate (#877): a renter who owes a once-per-subject consent is blocked
// across every `_renter` page until they accept. Inert until consent docs are
// published, so prod/e2e are unaffected.
function RenterLayout() {
  const { locale } = Route.useParams()
  return (
    <ConsentGate locale={locale}>
      <Outlet />
    </ConsentGate>
  )
}
