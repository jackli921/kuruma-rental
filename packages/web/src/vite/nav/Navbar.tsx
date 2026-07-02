import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useViewMode } from '@/vite/ViewModeProvider'
import { CurrencySelector } from '@/vite/currency'
import { useOperatorUnreadBadge, useUnreadBadge } from '@/vite/messaging'
import { LocaleSwitcher } from '@/vite/nav/LocaleSwitcher'
import { MobileMenu, type NavItem } from '@/vite/nav/MobileMenu'
import { NavBadge } from '@/vite/nav/NavBadge'
import { NavbarClient } from '@/vite/nav/NavbarClient'
import { visibleBusinessNavItems } from '@/vite/nav/business-nav-items'
import { visibleRenterNavItems } from '@/vite/nav/renter-nav-items'
import { useBusinessNavFlags, useRenterNavFlags } from '@/vite/nav/useNavFlags'
import { useNewBookingsBadge } from '@/vite/operator-bookings/useNewBookingsBadge'
import { useSession } from '@/vite/session'
import { isBusiness } from '@/vite/view-mode'
import { Link } from '@tanstack/react-router'
import { Car } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

// Client navbar (the SPA reads the session via useSession, not server auth()).
// Renter nav (#543): Browse is public (any renter-view session). My Bookings and
// Documents are personal "my data" pages gated on the actual RENTER role; Messages
// is a post-MVP feature gated by the admin-bypass rule (hidden in beta, shown to the
// platform admin for owner preview). That per-item split lives in renter-nav-items.ts
// so the gating is unit-tested without rendering. View state is not authorization
// state — an operator in renter view sees neither My Bookings nor Documents.
export function Navbar() {
  const { data: session } = useSession()
  const t = useTranslations('nav')
  const locale = useLocale()

  const role = session?.user?.role
  const canSwitchView = isBusiness(role)
  const viewMode = useViewMode(role)
  const isRenter = role === 'RENTER'

  // #611: in-app "new order" alert. Only an operator (business view) scans for
  // new bookings; the count rides the Bookings nav item as a red dot.
  const isBusinessView = viewMode === 'business'
  const { count: newBookingsCount } = useNewBookingsBadge({ enabled: isBusinessView })
  // #1032: renter unread-message badge on the Messages nav item (server-tracked,
  // unlike the operator badge); only scanned in renter view.
  const { count: unreadMessages } = useUnreadBadge({ userId: session?.user?.id, enabled: isRenter })
  // #1205: operator unread-message badge — tenant-level, only scanned in business view.
  const { count: operatorUnread } = useOperatorUnreadBadge({ enabled: isBusinessView })

  // #1322: nav visibility now reads the runtime-toggleable flags via useFeatureFlag,
  // so a dashboard override hides/shows an item live (the routes still redirect too).
  const businessNavFlags = useBusinessNavFlags()
  const renterNavFlags = useRenterNavFlags()

  // #1300: Browse (-> /search) leads every non-business nav — the public funnel
  // link a logged-out visitor sees and the renter's first item.
  const browseItem: NavItem = { to: '/$locale/search', label: t('browse') }

  const navItems: readonly NavItem[] = isBusinessView
    ? visibleBusinessNavItems(role, businessNavFlags).map((item) => ({
        to: item.to,
        label: t(item.labelKey),
        // exactOptionalPropertyTypes: only attach `badge` when there is one.
        ...(item.to === '/$locale/manage/bookings' && newBookingsCount > 0
          ? { badge: newBookingsCount, badgeLabel: t('newBookings', { count: newBookingsCount }) }
          : item.to === '/$locale/manage/messages' && operatorUnread > 0
            ? { badge: operatorUnread, badgeLabel: t('unreadMessages', { count: operatorUnread }) }
            : {}),
      }))
    : // Browse leads for renter and logged-out alike; the same array feeds the
      // desktop nav and the mobile drawer, so neither is ever empty (#1300).
      [
        browseItem,
        ...(session?.user
          ? visibleRenterNavItems(role, renterNavFlags).map((item) => ({
              to: item.to,
              label: t(item.labelKey),
              // exactOptionalPropertyTypes: only attach the badge when there is one.
              ...(item.to === '/$locale/messages' && unreadMessages > 0
                ? {
                    badge: unreadMessages,
                    badgeLabel: t('unreadMessages', { count: unreadMessages }),
                  }
                : {}),
            }))
          : []),
      ]

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
                {item.badge ? <NavBadge count={item.badge} label={item.badgeLabel ?? ''} /> : null}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <CurrencySelector />
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
