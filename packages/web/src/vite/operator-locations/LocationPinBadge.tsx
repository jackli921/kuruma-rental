import { Badge } from '@/components/ui/badge'
import type { OperatorLocation } from '@/vite/operator-locations/api'
import { Clock, MapPinOff } from 'lucide-react'
import { useTranslations } from 'use-intl'

// Surfaces a location's geocoding state (#601) only when its map pin needs
// attention: a throttle-skipped lookup (PENDING, #574) is retryable and the
// bulk re-geocode will resolve it, while a genuine miss (null) needs a manual
// pin. A confirmed pin (GEOCODED/MANUAL) renders nothing — keeps the list clean.
const PIN_STATE = {
  PENDING: {
    labelKey: 'pending',
    Icon: Clock,
    className: 'border-amber-500 text-amber-700 bg-amber-50',
  },
  MISSING: {
    labelKey: 'missing',
    Icon: MapPinOff,
    className: 'border-destructive/40 text-destructive bg-destructive/5',
  },
} as const

export function LocationPinBadge({
  coordinateSource,
}: {
  coordinateSource: OperatorLocation['coordinateSource']
}) {
  const t = useTranslations('business.locations.pin')

  if (coordinateSource === 'GEOCODED' || coordinateSource === 'MANUAL') return null
  const { labelKey, Icon, className } =
    coordinateSource === 'PENDING' ? PIN_STATE.PENDING : PIN_STATE.MISSING

  return (
    <Badge variant="outline" className={className}>
      <Icon className="size-3" aria-hidden />
      {t(labelKey)}
    </Badge>
  )
}
