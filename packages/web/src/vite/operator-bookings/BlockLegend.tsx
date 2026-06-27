import { BLOCK_KIND_CLASS } from '@/lib/event-colors'
import { VEHICLE_BLOCK_KINDS } from '@kuruma/shared/enums'
import { useTranslations } from 'use-intl'

// #1101 Slice B: a legend for the block bands so an operator can read the hatched
// kind colors at a glance (and tell a block from a status-colored booking). The
// swatch classes are the same BLOCK_KIND_CLASS the calendar applies; the band styles
// live in calendar-theme.css (loaded by the calendar on this page).
export function BlockLegend() {
  const t = useTranslations('bookings.operator.blocks')
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="font-medium">{t('legend.title')}</span>
      {VEHICLE_BLOCK_KINDS.map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span
            className={`inline-block h-3 w-4 rounded-sm border ${BLOCK_KIND_CLASS[k]}`}
            aria-hidden="true"
          />
          {t(`kinds.${k}`)}
        </span>
      ))}
    </div>
  )
}
