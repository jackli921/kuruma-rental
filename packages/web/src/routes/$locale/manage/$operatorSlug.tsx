import { PageSkeleton } from '@/vite/PageSkeleton'
import { manageGuard } from '@/vite/guards'
import { sessionQueryOptions } from '@/vite/session'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Operator workspace guard (#521 §8). The guard lives on the `$operatorSlug`
// layout (not a pathless parent) because it must read the slug param: a business
// role is necessary but the session slug must equal the URL slug. Fail-closed —
// no session -> provider login; wrong/absent slug -> landing. The API is the
// real boundary; this only keeps the UX honest.
export const Route = createFileRoute('/$locale/manage/$operatorSlug')({
  beforeLoad: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    const result = manageGuard(session, params.operatorSlug)
    if (result.type === 'login') {
      throw redirect({ to: '/$locale/provider/login', params: { locale: params.locale } })
    }
    if (result.type === 'forbidden') {
      throw redirect({ to: '/$locale', params: { locale: params.locale } })
    }
  },
  pendingComponent: PageSkeleton,
  component: Outlet,
})
