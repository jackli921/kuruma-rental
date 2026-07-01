import { Button } from '@/components/ui/button'
import { formatJpy } from '@/lib/format'
import { OperatorBadge } from '@/vite/operator-context'
import { FeeScheduleStatusBadge } from '@/vite/operator-fees/FeeScheduleStatusBadge'
import type { FeeScheduleData } from '@/vite/operator-fees/api'
import { Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface FeeRowProps {
  fee: FeeScheduleData
  /** Resolved class name (null = operator-wide). */
  className: string | null
  canWrite: boolean
  /** All-mode operator label (cross-tenant read); undefined hides the badge. */
  operatorName?: string | undefined
  onEdit: (f: FeeScheduleData) => void
  onArchive: (f: FeeScheduleData) => void
}

export function FeeRow({ fee, className, canWrite, operatorName, onEdit, onArchive }: FeeRowProps) {
  const t = useTranslations('business.fees')

  return (
    <div className="border border-border rounded-lg p-4 flex items-start gap-4 hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-medium truncate">{t(`type.${fee.feeType}`)}</h3>
          <FeeScheduleStatusBadge status={fee.status} />
          <OperatorBadge name={operatorName} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {formatJpy(fee.amountJpy)}{' '}
            <span className="text-muted-foreground">/ {t(`unit.${fee.unit}`)}</span>
          </span>
          <span>{className ?? t('form.operatorWide')}</span>
        </div>
      </div>

      {canWrite ? (
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => onEdit(fee)} aria-label={t('editFee')}>
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onArchive(fee)}
            aria-label={t('archiveAction')}
            disabled={fee.status === 'ARCHIVED'}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
