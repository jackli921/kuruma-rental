import { PageSkeleton } from '@/vite/PageSkeleton'
import { adminGuard } from '@/vite/guards'
import { AdminSidebar } from '@/vite/nav/AdminSidebar'
import { sessionQueryOptions } from '@/vite/session'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Platform admin layout guard (#462 §2.3, ported from the frozen Next.js
// `(admin)/layout.tsx`): admits PLATFORM_ADMIN only (legacy STAFF/ADMIN revoked in #487).
// Wrong role -> silent redirect to landing; signed-out -> login with returnTo.
export const Route = createFileRoute('/$locale/_admin')({
  beforeLoad: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    const result = adminGuard(session)
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
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <div className="flex flex-col md:flex-row flex-1">
      <AdminSidebar />
      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
