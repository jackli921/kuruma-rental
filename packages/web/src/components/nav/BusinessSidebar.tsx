'use client'

import { useLayoutPreference } from '@/components/providers/LayoutPreferenceProvider'
import { Link, usePathname } from '@/i18n/routing'
import { Calendar, Car, LayoutDashboard, MessageSquare, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

const SIDEBAR_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/manage/bookings', icon: Calendar, labelKey: 'bookings' },
  { href: '/manage/vehicles', icon: Car, labelKey: 'fleet' },
  { href: '/manage/customers', icon: Users, labelKey: 'customers' },
  { href: '/manage/messages', icon: MessageSquare, labelKey: 'messages' },
] as const

// Single static className string used for every link. Active state is driven
// by the `aria-current="page"` attribute and the `aria-[current=page]:*`
// Tailwind variants below. This keeps the className byte-for-byte identical
// between server and client renders, eliminating the hydration mismatch that
// occurred when the active/inactive branches produced different strings.
const LINK_CLASSNAME =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
  'text-sidebar-foreground hover:bg-sidebar-accent/50 ' +
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground ' +
  'aria-[current=page]:hover:bg-sidebar-accent'

export function BusinessSidebar() {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { preference } = useLayoutPreference()

  // Defer the active-state computation until after the client has hydrated.
  // The very first client render must produce the same DOM as the SSR pass,
  // so on the initial render we report `mounted=false` and emit no
  // `aria-current` attribute. After hydration completes, the effect flips
  // `mounted` to true and React re-renders to highlight the matching item.
  // The cost is a single frame where no item is highlighted; the benefit is
  // an absolute guarantee that this component cannot trigger a hydration
  // mismatch from a divergent `usePathname()` value.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (preference === 'topnav') return null

  return (
    <aside
      data-business-sidebar=""
      className="hidden md:flex flex-col w-56 shrink-0 border-r border-sidebar-border bg-sidebar"
    >
      <nav className="flex flex-col gap-1 p-3">
        {SIDEBAR_ITEMS.map(({ href, icon: Icon, labelKey }) => {
          const isActive = mounted && (pathname === href || pathname.startsWith(`${href}/`))
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
