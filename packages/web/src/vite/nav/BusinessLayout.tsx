import { useLayoutPreference } from '@/vite/LayoutPreferenceProvider'
import { useViewModeContext } from '@/vite/ViewModeProvider'
import { canPickOperatorContext } from '@/vite/guards'
import { BusinessSidebar } from '@/vite/nav/BusinessSidebar'
import { shouldShowBusinessSidebar } from '@/vite/nav/business-sidebar-visibility'
import {
  OperatorContextPicker,
  operatorsQueryOptions,
  useIsOperatorContextRoute,
} from '@/vite/operator-context'
import { useSession } from '@/vite/session'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// The consumer that was missing in the Vite migration (#966): reads the layout
// preference + the resolved view and renders the operator sidebar beside the page
// only when both agree on "business sidebar". Otherwise the page renders unchanged
// (top nav). Extracted from the route file so it is unit-testable without a router
// — the route passes <Outlet/> as children.
export function BusinessLayout({ children }: { readonly children: ReactNode }) {
  const { preference } = useLayoutPreference()
  const { data: session } = useSession()
  // PLATFORM_ADMIN only: the picker lets the lone uniformly-cross-tenant role choose
  // which operator the console operates as. It is shown ONLY on routes that thread
  // `?operator` into their reads (staged rollout) — on other business pages the param
  // is retained silently but the page is unscoped, so the picker would lie about scope.
  // Both hooks stay unconditional (hooks rule); the booleans combine in a const.
  const canPick = canPickOperatorContext(session ?? null)
  const isOperatorContextRoute = useIsOperatorContextRoute()
  const showPicker = canPick && isOperatorContextRoute
  // `enabled` gates the fetch so we never hit GET /operators when the picker is hidden.
  const { data: operators } = useQuery({ ...operatorsQueryOptions(), enabled: showPicker })
  // storedView is the reactive `kuruma-view` value (#1274): switching to renter view
  // drops the business sidebar in place instead of waiting for a full page reload.
  const { storedView } = useViewModeContext()
  const showSidebar = shouldShowBusinessSidebar(preference, session?.user?.role, storedView)

  const picker = showPicker ? <OperatorContextPicker operators={operators ?? []} /> : null

  if (!showSidebar) {
    return (
      <>
        {picker}
        {children}
      </>
    )
  }

  return (
    <>
      {picker}
      <div className="flex flex-col md:flex-row flex-1">
        <BusinessSidebar />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </>
  )
}
