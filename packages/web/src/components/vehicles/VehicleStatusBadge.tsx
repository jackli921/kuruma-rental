import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'next-intl'

const styleMap = {
  AVAILABLE: {
    variant: 'outline' as const,
    className: 'border-emerald-500 text-emerald-700 bg-emerald-50',
  },
  MAINTENANCE: {
    variant: 'outline' as const,
    className: 'border-amber-500 text-amber-700 bg-amber-50',
  },
  RETIRED: {
    variant: 'outline' as const,
    className: 'border-muted-foreground/30 text-muted-foreground',
  },
} as const

type VehicleStatus = keyof typeof styleMap

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const t = useTranslations('business.vehicles.status')
  const { variant, className } = styleMap[status]

  return (
    <Badge variant={variant} className={className}>
      {t(status)}
    </Badge>
  )
}
