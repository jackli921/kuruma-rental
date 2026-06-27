import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatJpy } from '@/lib/format'
import { AddOnStatusBadge } from '@/vite/operator-add-ons/AddOnStatusBadge'
import type { AddOnData } from '@/vite/operator-add-ons/api'
import { Coins, Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface AddOnRowProps {
  addOn: AddOnData
  canWrite: boolean
  operatorName?: string | undefined
  onEdit: (a: AddOnData) => void
  onArchive: (a: AddOnData) => void
}

export function AddOnRow({ addOn: a, canWrite, operatorName, onEdit, onArchive }: AddOnRowProps) {
  const t = useTranslations('business.addOns')
  const price = formatJpy(a.priceJpy)

  return (
    <div className="border border-border rounded-lg p-4 flex items-start gap-4 hover:bg-accent/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-medium truncate">{a.name}</h3>
          <AddOnStatusBadge status={a.status} />
          {operatorName && (
            <Badge variant="secondary" aria-label={`Operator: ${operatorName}`}>
              {operatorName}
            </Badge>
          )}
        </div>
        {a.description && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{a.description}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Coins className="size-3.5" />
            {t('row.price', { price })}
          </span>
        </div>
      </div>

      {canWrite ? (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(a)}
            aria-label={t('editOption')}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onArchive(a)}
            aria-label={t('archiveAction')}
            disabled={a.status === 'ARCHIVED'}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
