import { formatDateTime, formatJpy } from '@/lib/format'
import type { PaymentAnomalyView } from '@kuruma/shared/types/payment-anomaly'
import { useTranslations } from 'use-intl'

interface AnomaliesPanelProps {
  readonly anomalies: PaymentAnomalyView[]
  readonly locale: string
}

const DASH = '—'

// Whole JPY, but Stripe may omit amount_total on a malformed event — degrade a
// null to a dash so a money cell never reads "￥NaN".
function money(amount: number | null): string {
  return amount === null ? DASH : formatJpy(amount)
}

/**
 * Platform-admin panel of unresolved payment anomalies (#744) on the revenue tab
 * (#462). Pure function of props (FC/IS — the route owns the query + boundary).
 * DOUBLE_PAYMENT = a duplicate charge to refund; AMOUNT_MISMATCH = a charge whose
 * amount/currency differs from the booking snapshot to investigate. `stripeEventId`
 * is the reconciliation handle the admin carries to Stripe.
 */
export function AnomaliesPanel({ anomalies, locale }: AnomaliesPanelProps) {
  const t = useTranslations('admin.anomalies')
  const head = 'px-3 py-2 text-left font-medium text-muted-foreground'
  const headNum = 'px-3 py-2 text-right font-medium text-muted-foreground'

  return (
    <section className="rounded-xl border border-border p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        {anomalies.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 font-medium text-destructive text-sm tabular-nums">
            {anomalies.length}
          </span>
        )}
      </div>
      <p className="mt-1 text-muted-foreground text-sm">{t('subtitle')}</p>

      {anomalies.length === 0 ? (
        <p className="mt-4 text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="border-border border-b bg-muted/50">
              <tr>
                <th scope="col" className={head}>
                  {t('colKind')}
                </th>
                <th scope="col" className={head}>
                  {t('colBooking')}
                </th>
                <th scope="col" className={headNum}>
                  {t('colReceived')}
                </th>
                <th scope="col" className={headNum}>
                  {t('colExpected')}
                </th>
                <th scope="col" className={head}>
                  {t('colStripeEvent')}
                </th>
                <th scope="col" className={head}>
                  {t('colWhen')}
                </th>
              </tr>
            </thead>
            <tbody>
              {anomalies.map((a) => (
                <tr key={a.id} className="border-border border-b last:border-0">
                  <td className="px-3 py-2">
                    <KindBadge kind={a.kind} label={t(`kind.${a.kind}`)} />
                  </td>
                  <th scope="row" className="px-3 py-2 text-left font-mono font-normal text-xs">
                    {a.bookingId}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(a.receivedAmountJpy)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {money(a.expectedAmountJpy)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{a.stripeEventId}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    <time dateTime={a.createdAt}>{formatDateTime(a.createdAt, locale)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function KindBadge({
  kind,
  label,
}: {
  readonly kind: PaymentAnomalyView['kind']
  readonly label: string
}) {
  // DOUBLE_PAYMENT is money already taken twice (refund) — louder than a mismatch.
  const tone =
    kind === 'DOUBLE_PAYMENT'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs ${tone}`}
    >
      {label}
    </span>
  )
}
