'use client'

import { useLayoutPreference } from '@/components/providers/LayoutPreferenceProvider'
import { Link, usePathname } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { Calendar, Car, LayoutDashboard, MessageSquare, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'

const SIDEBAR_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { href: '/manage/bookings', icon: Calendar, labelKey: 'bookings' },
  { href: '/manage/vehicles', icon: Car, labelKey: 'fleet' },
  { href: '/manage/customers', icon: Users, labelKey: 'customers' },
  { href: '/manage/messages', icon: MessageSquare, labelKey: 'messages' },
] as const

export function BusinessSidebar() {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { preference } = useLayoutPreference()

  if (preference === 'topnav') return null

  return (
    <aside
      data-business-sidebar=""
      className="hidden md:flex flex-col w-56 shrink-0 border-r border-sidebar-border bg-sidebar"
    >
      <nav className="flex flex-col gap-1 p-3">
        {SIDEBAR_ITEMS.map(({ href, icon: Icon, labelKey }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
              )}
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
