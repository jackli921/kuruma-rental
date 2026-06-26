import { PageSkeleton } from '@/vite/PageSkeleton'
import { AnomaliesPanel } from '@/vite/admin/AnomaliesPanel'
import { AnomalyResolveDialog } from '@/vite/admin/anomalies/AnomalyResolveDialog'
import {
  type PaymentAnomalyStatusFilter,
  paymentAnomaliesQueryOptions,
} from '@/vite/admin/anomalies/api'
import type { PaymentAnomalyView } from '@kuruma/shared/types/payment-anomaly'
import { useQuery } from '@tanstack/react-query'
import { type ErrorComponentProps, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

const STATUSES = ['unresolved', 'resolved'] as const

// Platform-admin payment-anomaly resolution page (#1075 slice 3). The `_admin`
// parent layout already gates on platform-admin membership, so this owns the data:
// prefetch the unresolved queue, let the admin toggle to the resolved history, and
// open the resolve dialog per row. v1 records a verdict only — it moves NO money.
export const Route = createFileRoute('/$locale/_admin/admin/anomalies')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(paymentAnomaliesQueryOptions('unresolved')),
  pendingComponent: PageSkeleton,
  errorComponent: AnomaliesError,
  component: AnomaliesRoute,
})

function AnomaliesRoute() {
  const { locale } = Route.useParams()
  const t = useTranslations('admin.anomalies')
  const [status, setStatus] = useState<PaymentAnomalyStatusFilter>('unresolved')
  const [selected, setSelected] = useState<PaymentAnomalyView | null>(null)
  const { data, isPending } = useQuery(paymentAnomaliesQueryOptions(status))

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex gap-1 rounded-lg border border-border p-1 w-fit">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            aria-pressed={status === s}
            className="rounded-md px-3 py-1.5 font-medium text-sm transition-colors aria-pressed:bg-muted aria-[pressed=false]:text-muted-foreground aria-[pressed=false]:hover:bg-muted/50"
          >
            {t(`tab.${s}`)}
          </button>
        ))}
      </div>

      {data ? (
        <AnomaliesPanel
          anomalies={data.anomalies}
          locale={locale}
          // Action column only on the review queue; the resolved history is read-only.
          {...(status === 'unresolved' ? { onResolve: setSelected } : {})}
        />
      ) : isPending ? (
        <PageSkeleton />
      ) : null}

      <AnomalyResolveDialog
        anomaly={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </div>
  )
}

function AnomaliesError(_props: ErrorComponentProps) {
  const t = useTranslations('admin.anomalies')
  const router = useRouter()
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
      <p className="text-lg text-muted-foreground">{t('loadError')}</p>
      <button
        type="button"
        onClick={() => router.invalidate()}
        className="mt-4 inline-flex items-center rounded-lg border border-border px-4 py-2 font-medium text-sm hover:bg-muted/50"
      >
        {t('retry')}
      </button>
    </div>
  )
}
