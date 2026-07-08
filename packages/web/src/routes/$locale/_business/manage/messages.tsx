import { featureFlagsQueryOptions, isVisibleToViewer, resolveFeatureFlag } from '@/vite/config'
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
  // #1322: the messaging flag now reads the runtime override (a dashboard toggle
  // opens/closes the route live); the admin-bypass visibility rule is unchanged.
  beforeLoad: async ({ context, params }) => {
    // fetchQuery for the flags (not ensureQueryData) so a hard load honors a switchboard
    // override, not the seeded build-time default (#1486); fetchFeatureFlagOverrides is
    // fail-safe. Session stays ensureQueryData — its identity cache is unaffected.
    const [session, overrides] = await Promise.all([
      context.queryClient.ensureQueryData(sessionQueryOptions()),
      context.queryClient.fetchQuery(featureFlagsQueryOptions()),
    ])
    if (!isVisibleToViewer(resolveFeatureFlag(overrides, 'MESSAGING'), session?.user?.role)) {
      throw redirect({ to: '/$locale', params: { locale: params.locale } })
    }
  },
  component: Outlet,
})
