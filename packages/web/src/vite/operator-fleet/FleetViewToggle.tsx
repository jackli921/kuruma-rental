import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FleetViewMode } from '@/vite/operator-fleet/useFleetViewMode'
import { LayoutGrid, Rows3 } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface FleetViewToggleProps {
  readonly value: FleetViewMode
  readonly onChange: (next: FleetViewMode) => void
}

// Row/grid switch for the operator fleet (#561). A pair of pressed-state
// buttons; the parent owns the mode (via useFleetViewMode) so the table/grid
// branch and this control never drift.
export function FleetViewToggle({ value, onChange }: FleetViewToggleProps) {
  const t = useTranslations('business.vehicles.fleet')

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('rowView')}
        aria-pressed={value === 'row'}
        className={cn('h-7 px-2', value === 'row' && 'bg-muted')}
        onClick={() => onChange('row')}
      >
        <Rows3 className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('gridView')}
        aria-pressed={value === 'grid'}
        className={cn('h-7 px-2', value === 'grid' && 'bg-muted')}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid className="size-4" />
      </Button>
    </div>
  )
}
