import { PageSkeleton } from '@/vite/PageSkeleton'
import { businessGuard } from '@/vite/guards'
import { sessionQueryOptions } from '@/vite/session'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Business layout guard (spec §4.3): requires a business role. Wrong role -> silent
// redirect to the landing (razor line 122). Children (dashboard, manage/*) port later.
export const Route = createFileRoute('/$locale/_business')({
  beforeLoad: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    const result = businessGuard(session)
    if (result.type === 'login') {
      throw redirect({
        to: '/$locale/login',
        params: { locale: params.locale },
        search: { returnTo: location.pathname },
      })
    }
    if (result.type === 'forbidden') {
      throw redirect({ to: '/$locale', params: { locale: params.locale } })
    }
  },
  pendingComponent: PageSkeleton,
  component: Outlet,
})
