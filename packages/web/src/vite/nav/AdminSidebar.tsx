import { useFeatureFlag } from '@/vite/config'
import type { FeatureFlagKey } from '@kuruma/shared/feature-flags/registry'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Building2,
  CalendarCheck,
  ClipboardList,
  FileCheck,
  Flag,
  LayoutDashboard,
  Library,
  MessageSquareWarning,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

// Exported so the active-state test can derive its router tree from the single
// source of truth — a hard-coded copy there silently rots when an item is added.
export const SIDEBAR_ITEMS = [
  { to: '/$locale/admin', icon: LayoutDashboard, labelKey: 'nav.overview' },
  { to: '/$locale/admin/operators', icon: Building2, labelKey: 'nav.operators' },
  { to: '/$locale/admin/operator-applications', icon: ClipboardList, labelKey: 'nav.applications' },
  { to: '/$locale/admin/bookings', icon: CalendarCheck, labelKey: 'nav.bookings' },
  { to: '/$locale/admin/revenue', icon: Banknote, labelKey: 'nav.revenue' },
  { to: '/$locale/admin/anomalies', icon: AlertTriangle, labelKey: 'nav.anomalies' },
  { to: '/$locale/admin/documents', icon: FileCheck, labelKey: 'nav.documents' },
  { to: '/$locale/admin/customers', icon: Users, labelKey: 'nav.customers' },
  { to: '/$locale/admin/governance', icon: ShieldCheck, labelKey: 'nav.governance' },
  { to: '/$locale/admin/templates', icon: Library, labelKey: 'nav.templates' },
  { to: '/$locale/admin/reviews', icon: MessageSquareWarning, labelKey: 'nav.reviews' },
  { to: '/$locale/admin/feature-flags', icon: Flag, labelKey: 'nav.featureFlags' },
] as const

// Sidebar items hidden unless a runtime feature flag is on (keyed by `to`); an
// item absent here is always shown. Review moderation only matters once reviews
// are enabled (#1086) — dark-launched, so the link stays hidden by default.
const FLAG_GATED_ITEMS: Partial<Record<(typeof SIDEBAR_ITEMS)[number]['to'], FeatureFlagKey>> = {
  '/$locale/admin/reviews': 'REVIEWS',
}

// Single static className; active state is the `aria-current="page"` attribute
// (auto-set by TanStack on the active <Link>) + the `aria-[current=page]:*`
// Tailwind variants. SPA has no SSR, so the Next.js `mounted` guard (#25) is gone.
const LINK_CLASSNAME =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
  'text-sidebar-foreground hover:bg-sidebar-accent/50 ' +
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground ' +
  'aria-[current=page]:hover:bg-sidebar-accent'

export function AdminSidebar() {
  const t = useTranslations('admin')
  const locale = useLocale()
  // One lookup per gated flag; the map fail-closes (an unknown flag → hidden).
  const flags: Partial<Record<FeatureFlagKey, boolean>> = { REVIEWS: useFeatureFlag('REVIEWS') }
  const visibleItems = SIDEBAR_ITEMS.filter((item) => {
    const flag = FLAG_GATED_ITEMS[item.to]
    return flag === undefined || flags[flag] === true
  })

  return (
    <aside
      // Load-bearing: globals.css hides the always-mounted global Navbar via
      // `:root:has([data-admin-sidebar]) [data-global-nav]` (#481 review P2).
      data-admin-sidebar=""
      className="flex md:flex-col w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-sidebar-border bg-sidebar"
    >
      <nav className="flex flex-row md:flex-col gap-1 p-3 overflow-x-auto">
        {/* Escape hatch: on /admin the global nav links are CSS-hidden, so without
            this the only way back to the customer site is the easily-missed logo. */}
        <Link
          to="/$locale"
          params={{ locale }}
          // Exact, or TanStack's default prefix match makes `/$locale` active on
          // every `/$locale/admin/*` route — auto-stamping `aria-current="page"`
          // (and the active styling) onto this escape hatch on every admin page.
          activeOptions={{ exact: true }}
          className={`${LINK_CLASSNAME} text-muted-foreground md:mb-1 md:border-b md:border-sidebar-border md:pb-3 md:rounded-b-none`}
        >
          <ArrowLeft className="size-5" />
          {t('nav.backToSite')}
        </Link>
        {visibleItems.map(({ to, icon: Icon, labelKey }) => (
          <Link
            key={to}
            to={to}
            params={{ locale }}
            // Exact: the index link (/admin) must not stay active on /admin/revenue.
            // (TanStack auto-applies aria-current="page" to the active link.)
            activeOptions={{ exact: true }}
            className={LINK_CLASSNAME}
          >
            <Icon className="size-5" />
            {t(labelKey)}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
