import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'next-intl'

const variantMap = {
  AVAILABLE: 'default',
  MAINTENANCE: 'secondary',
  RETIRED: 'destructive',
} as const

type VehicleStatus = keyof typeof variantMap

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const t = useTranslations('business.vehicles.status')

  return <Badge variant={variantMap[status]}>{t(status)}</Badge>
}
