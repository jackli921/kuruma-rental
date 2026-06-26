import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { PAYMENT_ANOMALIES_QUERY_KEY, resolvePaymentAnomaly } from '@/vite/admin/anomalies/api'
import { useSession } from '@/vite/session'
import {
  PAYMENT_ANOMALY_RESOLUTIONS,
  type PaymentAnomalyResolution,
  type PaymentAnomalyView,
} from '@kuruma/shared/types/payment-anomaly'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface AnomalyResolveDialogProps {
  readonly anomaly: PaymentAnomalyView | null
  readonly onOpenChange: (open: boolean) => void
}

// Resolve an anomaly's review-queue item (#1075 slice 3). Self-contained like the
// operator dialogs: owns the CSRF token, the mutation, and the cache invalidation.
// v1 records WHY the charge was closed (+ optional note) — it moves NO money.
export function AnomalyResolveDialog({ anomaly, onOpenChange }: AnomalyResolveDialogProps) {
  const t = useTranslations('admin.anomalies')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutate, isPending, error } = useMutation({
    mutationFn: resolvePaymentAnomaly,
    onSuccess: () => {
      // A resolved row leaves the unresolved queue and joins the resolved list, so
      // invalidate the whole prefix — both status tabs refetch.
      queryClient.invalidateQueries({ queryKey: PAYMENT_ANOMALIES_QUERY_KEY })
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={anomaly !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resolve.title')}</DialogTitle>
          <DialogDescription>{t('resolve.description')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="px-1 text-destructive text-sm">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        {anomaly && (
          <ResolveForm
            key={anomaly.id}
            t={t}
            isSubmitting={isPending}
            onCancel={() => onOpenChange(false)}
            onSubmit={(resolution, note) =>
              mutate({ id: anomaly.id, resolution, csrfToken, ...(note ? { note } : {}) })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ResolveForm({
  t,
  isSubmitting,
  onCancel,
  onSubmit,
}: {
  readonly t: (key: string) => string
  readonly isSubmitting: boolean
  readonly onCancel: () => void
  readonly onSubmit: (resolution: PaymentAnomalyResolution, note: string) => void
}) {
  const [resolution, setResolution] = useState<PaymentAnomalyResolution>(
    PAYMENT_ANOMALY_RESOLUTIONS[0],
  )
  const [note, setNote] = useState('')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(resolution, note.trim())
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <label htmlFor="anomaly-resolution" className="font-medium text-sm">
          {t('resolve.resolutionLabel')}
        </label>
        <NativeSelect
          id="anomaly-resolution"
          value={resolution}
          onChange={(e) => setResolution(e.target.value as PaymentAnomalyResolution)}
        >
          {PAYMENT_ANOMALY_RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {t(`resolution.${r}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="anomaly-note" className="font-medium text-sm">
          {t('resolve.noteLabel')}
        </label>
        <Textarea
          id="anomaly-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder={t('resolve.notePlaceholder')}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('resolve.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('resolve.submitting') : t('resolve.submit')}
        </Button>
      </DialogFooter>
    </form>
  )
}
