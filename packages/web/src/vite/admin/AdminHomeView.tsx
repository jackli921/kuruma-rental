import { formatJpy } from '@/lib/format'
import type { AdminOverview } from '@kuruma/shared/types/admin-overview'
import { useTranslations } from 'use-intl'

interface AdminHomeViewProps {
  readonly overview: AdminOverview
}

// Platform-owner home overview (#1087, epic #1075 slice 1). Presentational: the
// route owns the loader / useSuspenseQuery + boundaries and passes the aggregate
// in, so this is a pure function of props. Renders the six platform-health KPIs as
// a card grid; GMV is formatted as yen, the rest as locale-grouped counts.
export function AdminHomeView({ overview }: AdminHomeViewProps) {
  const t = useTranslations('admin.home')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>

      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label={t('kpi.bookings')} value={overview.bookings.toLocaleString()} />
        <KpiCard label={t('kpi.gmv')} value={formatJpy(overview.gmvJpy)} />
        <KpiCard label={t('kpi.fleet')} value={overview.fleet.toLocaleString()} />
        <KpiCard label={t('kpi.operators')} value={overview.operators.toLocaleString()} />
        <KpiCard
          label={t('kpi.unresolvedAnomalies')}
          value={overview.unresolvedAnomalies.toLocaleString()}
        />
        <KpiCard label={t('kpi.pendingDocs')} value={overview.pendingDocs.toLocaleString()} />
      </dl>
    </div>
  )
}

function KpiCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-border p-6">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2 font-semibold text-3xl tabular-nums">{value}</dd>
    </div>
  )
}
