import { PageSkeleton } from '@/vite/PageSkeleton'
import { businessGuard } from '@/vite/guards'
import { BusinessLayout } from '@/vite/nav/BusinessLayout'
import { parseOperatorSearch } from '@/vite/operator-context'
import { sessionQueryOptions } from '@/vite/session'
import { Outlet, createFileRoute, redirect, retainSearchParams } from '@tanstack/react-router'

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
  // `operator` = the picked operator id (design §4.1). Absent = "All operators".
  // `retainSearchParams` carries it across every child navigation in one place, so
  // no `<Link>` needs to re-thread it; the fail direction is safe (dropped -> all-mode
  // read-only). The key is OPTIONAL (`operator?`) so child links never have to supply
  // it. The retain-vs-clear branch (key absent -> {} so retain carries it forward; key
  // present incl. an explicit `undefined` -> preserved) lives in `parseOperatorSearch`
  // (operator-context.ts), where it is unit-tested directly.
  validateSearch: (search: Record<string, unknown>): { operator?: string | undefined } =>
    parseOperatorSearch(search),
  search: { middlewares: [retainSearchParams(['operator'])] },
  pendingComponent: PageSkeleton,
  component: BusinessRoute,
})

// Wraps the nested business pages in the view-aware layout. Kept as a component
// (not an inline arrow) so the sidebar consumer is named in React devtools.
function BusinessRoute() {
  return (
    <BusinessLayout>
      <Outlet />
    </BusinessLayout>
  )
}
