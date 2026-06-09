import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LocaleSwitcher } from '@/vite/nav/LocaleSwitcher'
import { MobileMenu, type NavItem } from '@/vite/nav/MobileMenu'
import { NavbarClient } from '@/vite/nav/NavbarClient'
import { useSession } from '@/vite/session'
import { getViewMode, isBusiness } from '@/vite/view-mode'
import { Link } from '@tanstack/react-router'
import { Car } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

// Client navbar (the SPA reads the session via useSession, not server auth()).
// Public/renter destinations beyond bookings (search/vehicles/messages/manage)
// have no route yet — they arrive in 5d-2/5d-3 — so they are omitted here.
export function Navbar() {
  const { data: session } = useSession()
  const t = useTranslations('nav')
  const locale = useLocale()

  const role = session?.user?.role
  const canSwitchView = isBusiness(role)
  const viewMode = getViewMode(role)

  const navItems: readonly NavItem[] =
    viewMode === 'business'
      ? [{ to: '/$locale/dashboard', label: t('dashboard') }]
      : session?.user
        ? [{ to: '/$locale/bookings', label: t('bookings') }]
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
