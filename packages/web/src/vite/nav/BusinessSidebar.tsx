import { NavBadge } from '@/vite/nav/NavBadge'
import { visibleBusinessNavItems } from '@/vite/nav/business-nav-items'
import { useNewBookingsBadge } from '@/vite/operator-bookings/useNewBookingsBadge'
import { Link } from '@tanstack/react-router'
import { useLocale, useTranslations } from 'use-intl'

const BOOKINGS_TO = '/$locale/manage/bookings'

// Mirrors AdminSidebar's link styling. Active state is the `aria-current="page"`
// attribute (set by activeProps) + the `aria-[current=page]:*` Tailwind variants;
// `justify-between` parks the bookings badge at the right edge.
const LINK_CLASSNAME =
  'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
  'text-sidebar-foreground hover:bg-sidebar-accent/50 ' +
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground ' +
  'aria-[current=page]:hover:bg-sidebar-accent'

// The operator-portal left nav, shown when the layout preference is `sidebar`
// (BusinessLayout decides). md+ only: on mobile the MobileMenu already handles
// navigation, so the sidebar must not duplicate it.
export function BusinessSidebar() {
  const t = useTranslations('nav')
  const locale = useLocale()
  // Always business view here: BusinessLayout only mounts this in business view,
  // so the operator-scoped badge scan is safe to enable unconditionally.
  const { count: newBookingsCount } = useNewBookingsBadge({ enabled: true })

  return (
    <aside
      // Load-bearing: globals.css hides the top [data-business-nav] links via
      // `:root:has([data-business-sidebar]) [data-business-nav]` (#481 review P2).
      data-business-sidebar=""
      className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-sidebar-border bg-sidebar"
    >
      <nav className="flex flex-col gap-1 p-3">
        {visibleBusinessNavItems().map(({ to, labelKey }) => (
          <Link
            key={to}
            to={to}
            params={{ locale }}
            // Default (non-exact) matching, unlike AdminSidebar: business items have
            // detail children (manage/bookings/$bookingId, manage/fleet/$vehicleId),
            // so `exact` would drop the active state on a detail route (P2a). No `to`
            // is a prefix of another, so prefix matching causes no false-active.
            activeProps={{ 'aria-current': 'page' }}
            className={LINK_CLASSNAME}
          >
            {t(labelKey)}
            {to === BOOKINGS_TO && newBookingsCount > 0 ? (
              <NavBadge
                count={newBookingsCount}
                label={t('newBookings', { count: newBookingsCount })}
              />
            ) : null}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
