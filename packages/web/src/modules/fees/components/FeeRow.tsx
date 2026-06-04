'use client'

import { Button } from '@/components/ui/button'
import type { FeeScheduleData } from '@/modules/fees/api'
import { FeeScheduleStatusBadge } from '@/modules/fees/components/FeeScheduleStatusBadge'
import { Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface FeeRowProps {
  fee: FeeScheduleData
  className: string | null
  onEdit: (f: FeeScheduleData) => void
  onArchive: (f: FeeScheduleData) => void
}

export function FeeRow({ fee, className, onEdit, onArchive }: FeeRowProps) {
  const t = useTranslations('business.fees')
  const amount = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(
    fee.amountJpy,
  )

  return (
    <div className="border border-border rounded-lg p-4 flex items-start gap-4 hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-medium truncate">{t(`type.${fee.feeType}`)}</h3>
          <FeeScheduleStatusBadge status={fee.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {amount} <span className="text-muted-foreground">/ {t(`unit.${fee.unit}`)}</span>
          </span>
          <span>{className ?? t('form.operatorWide')}</span>
        </div>
      </div>

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
    </div>
  )
}
