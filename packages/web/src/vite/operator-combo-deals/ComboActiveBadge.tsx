import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'use-intl'

// Combo deals have no soft-archive lifecycle — only an `isActive` toggle. Green
// "Active" / muted "Inactive", mirroring the fee-schedule status badge styling.
const styleMap = {
  active: {
    variant: 'outline' as const,
    className: 'border-emerald-500 text-emerald-700 bg-emerald-50',
  },
  inactive: {
    variant: 'outline' as const,
    className: 'border-muted-foreground/30 text-muted-foreground',
  },
} as const

export function ComboActiveBadge({ isActive }: { isActive: boolean }) {
  const t = useTranslations('business.comboDeals.status')
  const key = isActive ? 'active' : 'inactive'
  const { variant, className } = styleMap[key]

  return (
    <Badge variant={variant} className={className}>
      {t(key)}
    </Badge>
  )
}
