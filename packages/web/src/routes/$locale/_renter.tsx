import { PageSkeleton } from '@/vite/PageSkeleton'
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
  component: Outlet,
})
