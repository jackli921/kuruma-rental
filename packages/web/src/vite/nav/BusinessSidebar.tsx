import { useOperatorUnreadBadge } from '@/vite/messaging'
import { NavBadge } from '@/vite/nav/NavBadge'
import { visibleBusinessNavGroups } from '@/vite/nav/business-nav-items'
import { useBusinessNavFlags } from '@/vite/nav/useNavFlags'
import { useNewBookingsBadge } from '@/vite/operator-bookings/useNewBookingsBadge'
import { useSession } from '@/vite/session'
import { Link } from '@tanstack/react-router'
import { useLocale, useTranslations } from 'use-intl'

const BOOKINGS_TO = '/$locale/manage/bookings'
const MESSAGES_TO = '/$locale/manage/messages'

// Mirrors AdminSidebar's link styling. Active state is the `aria-current="page"`
// attribute (set by activeProps) + the `aria-[current=page]:*` Tailwind variants;
// `justify-between` parks the bookings/unread badge at the right edge.
const LINK_CLASSNAME =
  'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ' +
  'text-sidebar-foreground hover:bg-sidebar-accent/50 ' +
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground ' +
  'aria-[current=page]:hover:bg-sidebar-accent'

// Non-interactive section header above each group of links.
const HEADING_CLASSNAME =
  'px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60'

// The operator-portal left nav, shown when the layout preference is `sidebar`
// (BusinessLayout decides). md+ only: on mobile the MobileMenu already handles
// navigation, so the sidebar must not duplicate it. Unlike the flat top nav, the
// sidebar renders the nav as labelled sections (visibleBusinessNavGroups) so the
// operator's 12 routes read as a hierarchy instead of one long list.
export function BusinessSidebar() {
  const t = useTranslations('nav')
  const locale = useLocale()
  const { data: session } = useSession()
  // Always business view here: BusinessLayout only mounts this in business view,
  // so the operator-scoped badge scans are safe to enable unconditionally.
  const { count: newBookingsCount } = useNewBookingsBadge({ enabled: true })
  const { count: operatorUnread } = useOperatorUnreadBadge({ enabled: true })
  // #1322: read the runtime-toggleable nav flags so a dashboard override reflects live.
  const businessNavFlags = useBusinessNavFlags()

  return (
    <aside
      // Load-bearing: globals.css hides the top [data-business-nav] links via
      // `:root:has([data-business-sidebar]) [data-business-nav]` (#481 review P2).
      data-business-sidebar=""
      className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-sidebar-border bg-sidebar"
    >
      <nav className="flex flex-col gap-4 p-3">
        {visibleBusinessNavGroups(session?.user?.role, businessNavFlags).map((group) => {
          const headingId = `nav-group-${group.labelKey}`
          return (
            <div key={group.labelKey}>
              <h2 id={headingId} className={HEADING_CLASSNAME}>
                {t(group.labelKey)}
              </h2>
              {/* aria-labelledby names the list after its header, so a screen reader
                  announces "Operations, list, 3 items" instead of an unlabelled list. */}
              <ul aria-labelledby={headingId} className="flex flex-col gap-1">
                {group.items.map(({ to, labelKey }) => (
                  <li key={to}>
                    <Link
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
                      {to === MESSAGES_TO && operatorUnread > 0 ? (
                        <NavBadge
                          count={operatorUnread}
                          label={t('unreadMessages', { count: operatorUnread })}
                        />
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
