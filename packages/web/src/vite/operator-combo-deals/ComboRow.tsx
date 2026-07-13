import { Button } from '@/components/ui/button'
import { formatJpy } from '@/lib/format'
import { ComboActiveBadge } from '@/vite/operator-combo-deals/ComboActiveBadge'
import type { ClassRatePlanData } from '@/vite/operator-combo-deals/api'
import { OperatorBadge } from '@/vite/operator-context'
import { Pencil, Power, Trash2 } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface ComboRowProps {
  deal: ClassRatePlanData
  /** Resolved vehicle-class name (null when the class can't be resolved). */
  className: string | null
  /** Resolved pickup-location name (null when it can't be resolved). */
  locationName: string | null
  canWrite: boolean
  /** All-mode operator label (cross-tenant read); undefined hides the badge. */
  operatorName?: string | undefined
  onEdit: (d: ClassRatePlanData) => void
  onToggle: (d: ClassRatePlanData) => void
  onRemove: (d: ClassRatePlanData) => void
}

export function ComboRow({
  deal,
  className,
  locationName,
  canWrite,
  operatorName,
  onEdit,
  onToggle,
  onRemove,
}: ComboRowProps) {
  const t = useTranslations('business.comboDeals')

  return (
    <div
      data-testid="combo-row"
      className="border border-border rounded-lg p-4 flex items-start gap-4 hover:bg-accent/30 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-medium truncate">{className ?? t('unknownClass')}</h3>
          <ComboActiveBadge isActive={deal.isActive} />
          <OperatorBadge name={operatorName} />
        </div>
        {deal.label ? (
          <p className="mt-1 text-sm text-muted-foreground truncate">{deal.label}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {formatJpy(deal.dayRateJpy)}{' '}
            <span className="text-muted-foreground">/ {t('perDay')}</span>
          </span>
          <span>{locationName ?? t('unknownLocation')}</span>
        </div>
      </div>

      {canWrite ? (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggle(deal)}
            aria-label={deal.isActive ? t('deactivateAction') : t('activateAction')}
          >
            <Power className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(deal)}
            aria-label={t('editDeal')}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemove(deal)}
            aria-label={t('removeAction')}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
