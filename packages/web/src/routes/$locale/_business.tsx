import { PageSkeleton } from '@/vite/PageSkeleton'
import { businessGuard } from '@/vite/guards'
import { BusinessLayout } from '@/vite/nav/BusinessLayout'
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
  // it. Branching on `'operator' in search` is load-bearing: a navigation that OMITS
  // the key (a plain sidebar link) returns `{}`, letting retainSearchParams carry the
  // current value forward; the picker's explicit `operator: undefined` clear returns
  // `{ operator: undefined }` (key present-but-empty), which retainSearchParams leaves
  // alone instead of re-adding the previous id (see router-core searchMiddleware).
  validateSearch: (search: Record<string, unknown>): { operator?: string | undefined } => {
    if (!('operator' in search)) return {}
    const value = search.operator
    return typeof value === 'string' && value.length > 0
      ? { operator: value }
      : { operator: undefined }
  },
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
