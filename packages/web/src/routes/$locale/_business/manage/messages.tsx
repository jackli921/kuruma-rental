import { isMessagingEnabled, isVisibleToViewer } from '@/vite/config'
import { sessionQueryOptions } from '@/vite/session'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Layout for the operator inbox under `/<locale>/manage/messages` (#1205 slice 3).
// The business role is enforced by the parent `_business` guard; this adds the
// post-MVP visibility gate: messaging is hidden in beta, so a viewer who can't see
// it is redirected home even if they type the URL (the nav entry is already hidden
// by business-nav-items). The platform admin passes (owner preview via admin
// bypass); an operator is sent home while the flag is OFF. Mirrors the renter
// `_renter/messages.tsx` gate. Visibility only — the messaging API still enforces
// its own operator tenant scoping (#1205 slice 2).
export const Route = createFileRoute('/$locale/_business/manage/messages')({
  beforeLoad: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions())
    if (!isVisibleToViewer(isMessagingEnabled(), session?.user?.role)) {
      throw redirect({ to: '/$locale', params: { locale: params.locale } })
    }
  },
  component: Outlet,
})
