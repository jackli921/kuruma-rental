'use client'

import { Link, usePathname } from '@/i18n/routing'
import { Banknote, LayoutDashboard } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

const SIDEBAR_ITEMS = [
  { href: '/admin', icon: LayoutDashboard, labelKey: 'nav.overview' },
  { href: '/admin/revenue', icon: Banknote, labelKey: 'nav.revenue' },
] as const

// Single static className string used for every link. Active state is driven
// by the `aria-current="page"` attribute and the `aria-[current=page]:*`
// Tailwind variants below, keeping the className byte-for-byte identical
// between server and client renders (the #25 hydration-mismatch fix).
const LINK_CLASSNAME =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
  'text-sidebar-foreground hover:bg-sidebar-accent/50 ' +
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground ' +
  'aria-[current=page]:hover:bg-sidebar-accent'

export function AdminSidebar() {
  const t = useTranslations('admin')
  const pathname = usePathname()

  // Defer active-state until after hydration: the first client render must
  // match the SSR DOM, so `mounted=false` emits no `aria-current`; the effect
  // then flips it on. See BusinessSidebar for the full rationale (#25).
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // The overview href (`/admin`) is a prefix of every sub-route, so a plain
  // `startsWith` would highlight it everywhere. Pick the longest matching href
  // instead, so the index link is active only on the exact `/admin` path.
  const activeHref = SIDEBAR_ITEMS.filter(
    ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
  ).reduce((longest, { href }) => (href.length > longest.length ? href : longest), '')

  return (
    <aside
      data-admin-sidebar=""
      className="hidden md:flex flex-col w-56 shrink-0 border-r border-sidebar-border bg-sidebar"
    >
      <nav className="flex flex-col gap-1 p-3">
        {SIDEBAR_ITEMS.map(({ href, icon: Icon, labelKey }) => {
          const isActive = mounted && href === activeHref
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={LINK_CLASSNAME}
            >
              <Icon className="size-5" />
              {t(labelKey)}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
