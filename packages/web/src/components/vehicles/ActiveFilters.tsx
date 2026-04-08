import { Calendar } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface ActiveFiltersProps {
  readonly from?: string
  readonly to?: string
}

export function ActiveFilters({ from, to }: ActiveFiltersProps) {
  const t = useTranslations('vehicles')

  if (!from && !to) return null

  return (
    <div data-testid="active-filters" className="flex flex-wrap items-center gap-3">
      {from && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-sm font-medium">
          <Calendar className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('filters.from')}</span>
          <span>{from}</span>
        </span>
      )}
      {to && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-sm font-medium">
          <Calendar className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('filters.to')}</span>
          <span>{to}</span>
        </span>
      )}
    </div>
  )
}
