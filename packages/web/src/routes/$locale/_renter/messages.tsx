import { isMessagingEnabled, isVisibleToViewer } from '@/vite/config'
import { sessionQueryOptions } from '@/vite/session'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Layout for everything under `/<locale>/messages` (#1032). The renter guard lives on
// the parent `_renter` route; this adds the post-MVP visibility gate: messaging is
// hidden in beta, so a viewer who can't see it is redirected home even if they type
// the URL (the nav entry is already hidden by renter-nav-items). The platform admin
// passes (owner preview); a renter is sent home while the flag is OFF. Mirrors the
// redirect pattern in `_admin.tsx`. Visibility only — the messaging API still enforces
// its own per-participant access (design §2.1).
export const Route = createFileRoute('/$locale/_renter/messages')({
  beforeLoad: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (!isVisibleToViewer(isMessagingEnabled(), session?.user?.role)) {
      throw redirect({ to: '/$locale', params: { locale: params.locale } })
    }
  },
  component: Outlet,
})
