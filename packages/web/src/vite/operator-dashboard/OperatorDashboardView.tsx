import { isOperatorTodayEnabled } from '@/vite/config'
import { TodayPanel } from '@/vite/operator-dashboard/TodayPanel'
import { ComplianceBanner } from '@/vite/operator-fleet/ComplianceBanner'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import type { Session } from '@/vite/session'
import type { OperatorOverview } from '@kuruma/shared/types/overview'
import { Link } from '@tanstack/react-router'
import { CalendarDays, CarFront, Clock } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface OperatorDashboardViewProps {
  readonly overview: OperatorOverview
  // The operator's fleet, fed to the §5.5 compliance banner (#916) and the #1102
  // Today panel (vehicle-name lookup). The route already warms this query for the
  // Manage Fleet link, so reading it here is a cache hit, not a second round-trip.
  readonly vehicles: readonly OperatorFleetVehicle[]
  // #1102: the Today panel's inline advance is a CSRF-gated write, so it needs the
  // session token; the panel also gates itself via `canWriteAsOperator`.
  readonly session: Session | null
  readonly locale: string
  // #1433: forwarded to the Today panel so a picker admin's inline status advance
  // binds to the operator it is acting as (mirrors the trip-detail write surface).
  readonly pickedOperatorId?: string | undefined
}

// Presentational operator overview (#524). The route owns the loader /
// useSuspenseQuery and the pending/error boundaries; this stays a pure function
// of the resolved counts so it is unit-testable (FC/IS — the shell does I/O,
// this renders). All three figures are already operator-scoped by the API.
export function OperatorDashboardView({
  overview,
  vehicles,
  session,
  locale,
  pickedOperatorId,
}: OperatorDashboardViewProps) {
  const t = useTranslations('business')

  const tiles = [
    { label: t('stats.totalBookings'), icon: CalendarDays, value: overview.totalBookings },
    { label: t('stats.activeVehicles'), icon: CarFront, value: overview.activeVehicles },
    { label: t('stats.upcomingBookings'), icon: Clock, value: overview.upcomingBookings },
  ]

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('dashboard.subtitle')}</p>

        <ComplianceBanner vehicles={vehicles} locale={locale} />

        {/* #1102 Today panel, gated OFF for the beta MVP (#1329). The panel also
            self-gates to an operator session; this flag hides it entirely otherwise. */}
        {isOperatorTodayEnabled() && (
          <TodayPanel
            today={overview.today}
            vehicles={vehicles}
            session={session}
            locale={locale}
            pickedOperatorId={pickedOperatorId}
          />
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map(({ label, icon: Icon, value }) => (
            <div key={label} className="rounded-xl border border-border p-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">{label}</span>
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="mt-2 font-semibold text-3xl tabular-nums">{value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/$locale/manage/bookings"
            params={{ locale }}
            className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
          >
            {t('dashboard.viewBookings')}
          </Link>
          <Link
            to="/$locale/manage/fleet"
            params={{ locale }}
            className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
          >
            {t('dashboard.manageFleet')}
          </Link>
        </div>
      </div>
    </main>
  )
}
