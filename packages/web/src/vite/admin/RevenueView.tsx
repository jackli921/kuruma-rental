import { formatJpy } from '@/lib/format'
import type { AdminRevenuePartner, AdminRevenueReport } from '@kuruma/shared/types/admin-revenue'
import { useTranslations } from 'use-intl'

interface RevenueViewProps {
  readonly report: AdminRevenueReport
}

// Presentational partner-revenue report (#462). The route owns the loader /
// useSuspenseQuery + boundaries; this is a pure function of the resolved report
// so it is unit-testable (FC/IS — the shell does I/O, this only renders). Every
// figure is summed server-side from `payment_events` rows; we never recompute the
// 4% here — the row is the contract.
export function RevenueView({ report }: RevenueViewProps) {
  const t = useTranslations('admin.revenue')
  const { partners, totals } = report

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      <p className="text-sm text-muted-foreground mt-3 max-w-3xl">{t('model')}</p>

      {partners.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <section className="mt-6 rounded-xl border border-border p-6">
            <h2 className="text-sm font-medium text-muted-foreground">{t('allPartners')}</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label={t('gross')} value={formatJpy(totals.grossJpy)} />
              <Stat label={t('platformFee')} value={formatJpy(totals.platformFeeJpy)} />
              <Stat label={t('netPayable')} value={formatJpy(totals.netToPartnerJpy)} />
              <Stat label={t('payments')} value={totals.paymentCount.toLocaleString()} />
            </dl>
          </section>

          <div className="mt-8 space-y-8">
            {partners.map((partner) => (
              <PartnerTable key={partner.operatorId} partner={partner} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold text-2xl tabular-nums">{value}</dd>
    </div>
  )
}

function PartnerTable({ partner }: { readonly partner: AdminRevenuePartner }) {
  const t = useTranslations('admin.revenue')
  const cellNum = 'px-3 py-2 text-right tabular-nums'
  const head = 'px-3 py-2 text-right font-medium text-muted-foreground'

  return (
    <section>
      <h2 className="text-lg font-semibold">{partner.operatorName}</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-border border-b bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
                {t('month')}
              </th>
              <th scope="col" className={head}>
                {t('gross')}
              </th>
              <th scope="col" className={head}>
                {t('platformFee')}
              </th>
              <th scope="col" className={head}>
                {t('netPayable')}
              </th>
              <th scope="col" className={head}>
                {t('payments')}
              </th>
            </tr>
          </thead>
          <tbody>
            {partner.months.map((m) => (
              <tr key={m.month} className="border-border border-b last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-normal tabular-nums">
                  {m.month}
                </th>
                <td className={cellNum}>{formatJpy(m.grossJpy)}</td>
                <td className={cellNum}>{formatJpy(m.platformFeeJpy)}</td>
                <td className={cellNum}>{formatJpy(m.netToPartnerJpy)}</td>
                <td className={cellNum}>{m.paymentCount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-border border-t font-medium">
            <tr>
              <th scope="row" className="px-3 py-2 text-left">
                {t('total')}
              </th>
              <td className={cellNum}>{formatJpy(partner.grossJpy)}</td>
              <td className={cellNum}>{formatJpy(partner.platformFeeJpy)}</td>
              <td className={cellNum}>{formatJpy(partner.netToPartnerJpy)}</td>
              <td className={cellNum}>{partner.paymentCount.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
