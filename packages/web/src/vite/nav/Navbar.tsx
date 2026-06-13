import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LocaleSwitcher } from '@/vite/nav/LocaleSwitcher'
import { MobileMenu, type NavItem } from '@/vite/nav/MobileMenu'
import { NavbarClient } from '@/vite/nav/NavbarClient'
import { businessNavItems } from '@/vite/nav/business-nav-items'
import { useSession } from '@/vite/session'
import { getViewMode, isBusiness } from '@/vite/view-mode'
import { Link } from '@tanstack/react-router'
import { Car } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

// Client navbar (the SPA reads the session via useSession, not server auth()).
// Renter nav (#543): Browse is public (any renter-view session); My Bookings and
// Documents are personal "my data" pages, so they are gated on the actual RENTER
// role — NOT viewMode. An operator who switches to renter view must not see them,
// or they would drift to tenant data (view state is not authorization state).
export function Navbar() {
  const { data: session } = useSession()
  const t = useTranslations('nav')
  const locale = useLocale()

  const role = session?.user?.role
  const canSwitchView = isBusiness(role)
  const viewMode = getViewMode(role)
  const isRenter = role === 'RENTER'

  const renterNavItems: readonly NavItem[] = isRenter
    ? [
        { to: '/$locale/bookings', label: t('myBookings') },
        { to: '/$locale/documents', label: t('documents') },
      ]
    : []

  const navItems: readonly NavItem[] =
    viewMode === 'business'
      ? businessNavItems.map((item) => ({ to: item.to, label: t(item.labelKey) }))
      : session?.user
        ? [{ to: '/$locale/search', label: t('browse') }, ...renterNavItems]
        : []

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <Link
            to="/$locale"
            params={{ locale }}
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <Car className="size-5" />
            <span className="hidden sm:inline">Kuruma</span>
          </Link>

          {/* `data-global-nav` (always) drives the admin-shell hide rule;
              `data-business-nav` (business view only) drives the business-sidebar
              hide rule (#481 review P2). */}
          <nav
            className="hidden md:flex items-center gap-1"
            data-global-nav=""
            {...(viewMode === 'business' && { 'data-business-nav': '' })}
          >
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                params={{ locale }}
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <NavbarClient
              session={session ?? null}
              canSwitchView={canSwitchView}
              viewMode={viewMode}
            />
            <MobileMenu session={session ?? null} navItems={navItems} />
          </div>
        </div>
      </div>
    </header>
  )
}
