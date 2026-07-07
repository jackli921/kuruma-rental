import { Button } from '@/components/ui/button'
import { formatJpy } from '@/lib/format'
import { OperatorBadge } from '@/vite/operator-context'
import { InsuranceStatusBadge } from '@/vite/operator-insurance/InsuranceStatusBadge'
import type { InsuranceOptionData } from '@/vite/operator-insurance/api'
import { Coins, Pencil, ShieldCheck, Trash2 } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface InsuranceRowProps {
  option: InsuranceOptionData
  canWrite: boolean
  operatorName?: string | undefined
  onEdit: (o: InsuranceOptionData) => void
  onArchive: (o: InsuranceOptionData) => void
}

export function InsuranceRow({
  option: o,
  canWrite,
  operatorName,
  onEdit,
  onArchive,
}: InsuranceRowProps) {
  const t = useTranslations('business.insurance')
  const dailyPrice = formatJpy(o.dailyPriceJpy)
  const deductible = o.deductibleJpy != null ? formatJpy(o.deductibleJpy) : null

  return (
    <div className="border border-border rounded-lg p-4 flex items-start gap-4 hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-medium truncate">{o.resolvedName}</h3>
          <InsuranceStatusBadge status={o.status} />
          <OperatorBadge name={operatorName} />
        </div>
        {o.description && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{o.description}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Coins className="size-3.5" />
            {t('row.perDay', { price: dailyPrice })}
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" />
            {deductible ? t('row.deductible', { amount: deductible }) : t('row.noDeductible')}
          </span>
        </div>
      </div>

      {canWrite ? (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(o)}
            aria-label={t('editOption')}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onArchive(o)}
            aria-label={t('archiveAction')}
            disabled={o.status === 'ARCHIVED'}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
