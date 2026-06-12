import { Link } from '@tanstack/react-router'
import { Banknote, LayoutDashboard } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

const SIDEBAR_ITEMS = [
  { to: '/$locale/admin', icon: LayoutDashboard, labelKey: 'nav.overview' },
  { to: '/$locale/admin/revenue', icon: Banknote, labelKey: 'nav.revenue' },
] as const

// Single static className; active state is the `aria-current="page"` attribute
// (set by TanStack's activeProps) + the `aria-[current=page]:*` Tailwind variants.
// SPA has no SSR, so the Next.js `mounted` hydration guard (#25) is unnecessary.
const LINK_CLASSNAME =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
  'text-sidebar-foreground hover:bg-sidebar-accent/50 ' +
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground ' +
  'aria-[current=page]:hover:bg-sidebar-accent'

export function AdminSidebar() {
  const t = useTranslations('admin')
  const locale = useLocale()

  return (
    <aside
      // Load-bearing: globals.css hides the always-mounted global Navbar via
      // `:root:has([data-admin-sidebar]) [data-global-nav]` (#481 review P2).
      data-admin-sidebar=""
      className="flex md:flex-col w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-sidebar-border bg-sidebar"
    >
      <nav className="flex flex-row md:flex-col gap-1 p-3 overflow-x-auto">
        {SIDEBAR_ITEMS.map(({ to, icon: Icon, labelKey }) => (
          <Link
            key={to}
            to={to}
            params={{ locale }}
            // Exact: the index link (/admin) must not stay active on /admin/revenue.
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
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
