import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'next-intl'

const styleMap = {
  ACTIVE: {
    variant: 'outline' as const,
    className: 'border-emerald-500 text-emerald-700 bg-emerald-50',
  },
  ARCHIVED: {
    variant: 'outline' as const,
    className: 'border-muted-foreground/30 text-muted-foreground',
  },
} as const

export type InsuranceStatus = keyof typeof styleMap

export function InsuranceStatusBadge({ status }: { status: InsuranceStatus }) {
  const t = useTranslations('business.insurance.status')
  const { variant, className } = styleMap[status]

  return (
    <Badge variant={variant} className={className}>
      {t(status)}
    </Badge>
  )
}
