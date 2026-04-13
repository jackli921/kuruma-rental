import { Badge } from '@/components/ui/badge'
import type { ExpiryStatus } from '@kuruma/shared/lib/expiry'
import { useTranslations } from 'next-intl'

interface ExpiryBadgeProps {
  readonly status: ExpiryStatus
  readonly label: 'shaken' | 'insurance'
}

const VARIANT_MAP: Record<
  ExpiryStatus,
  { variant: 'secondary' | 'destructive' | 'outline'; className?: string }
> = {
  OK: { variant: 'secondary' },
  EXPIRING_SOON: { variant: 'outline', className: 'border-amber-500 text-amber-700' },
  EXPIRED: { variant: 'destructive' },
  UNKNOWN: { variant: 'outline' },
}

export function ExpiryBadge({ status, label }: ExpiryBadgeProps) {
  const t = useTranslations('business.vehicles')
  const { variant, className } = VARIANT_MAP[status]

  return (
    <Badge data-testid="expiry-badge" variant={variant} className={className}>
      {t(`expiry.${label}.${status}`)}
    </Badge>
  )
}
