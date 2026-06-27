import { formatDateTime } from '@/lib/format'
import { useTranslations } from 'use-intl'
import type { OperatorSummary } from './api'

interface OperatorSummaryViewProps {
  readonly summary: OperatorSummary
  readonly locale: string
}

type Accent = 'default' | 'warning' | 'danger'

const ACCENT: Record<Accent, string> = {
  default: 'text-foreground',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
}

function StatTile({
  label,
  value,
  accent = 'default',
}: {
  readonly label: string
  readonly value: string
  readonly accent?: Accent
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={`mt-1 font-semibold text-2xl tabular-nums ${ACCENT[accent]}`}>{value}</div>
    </div>
  )
}

/**
 * Per-operator metrics & compliance roll-up card (#1120). Pure function of props
 * (FC/IS — the route owns the query). The two attention tiles tint only when they
 * carry work: a missing/expired certificate is danger, an expiring-soon one is a
 * warning; everything in-date stays neutral.
 */
export function OperatorSummaryView({ summary, locale }: OperatorSummaryViewProps) {
  const t = useTranslations('admin.operators.summary')

  return (
    <section className="space-y-4">
      <div>
        <h1 className="font-semibold text-2xl">{summary.name}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label={t('vehicleCount')} value={String(summary.vehicleCount)} />
        <StatTile
          label={t('needingDocs')}
          value={String(summary.vehiclesNeedingDocs)}
          accent={summary.vehiclesNeedingDocs > 0 ? 'danger' : 'default'}
        />
        <StatTile
          label={t('expiringSoon')}
          value={String(summary.vehiclesExpiringSoon)}
          accent={summary.vehiclesExpiringSoon > 0 ? 'warning' : 'default'}
        />
        <StatTile label={t('totalBookings')} value={String(summary.totalBookings)} />
        <StatTile label={t('upcomingBookings')} value={String(summary.upcomingBookings)} />
        <StatTile
          label={t('lastAlert')}
          value={
            summary.lastComplianceAlertAt
              ? formatDateTime(summary.lastComplianceAlertAt, locale)
              : t('never')
          }
        />
      </div>
    </section>
  )
}
