import { useLayoutPreference } from '@/vite/LayoutPreferenceProvider'
import { BusinessSidebar } from '@/vite/nav/BusinessSidebar'
import { shouldShowBusinessSidebar } from '@/vite/nav/business-sidebar-visibility'
import { useSession } from '@/vite/session'
import { readViewCookie } from '@/vite/view-mode'
import type { ReactNode } from 'react'

// The consumer that was missing in the Vite migration (#966): reads the layout
// preference + the resolved view and renders the operator sidebar beside the page
// only when both agree on "business sidebar". Otherwise the page renders unchanged
// (top nav). Extracted from the route file so it is unit-testable without a router
// — the route passes <Outlet/> as children.
export function BusinessLayout({ children }: { readonly children: ReactNode }) {
  const { preference } = useLayoutPreference()
  const { data: session } = useSession()
  const showSidebar = shouldShowBusinessSidebar(preference, session?.user?.role, readViewCookie())

  if (!showSidebar) return <>{children}</>

  return (
    <div className="flex flex-col md:flex-row flex-1">
      <BusinessSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
