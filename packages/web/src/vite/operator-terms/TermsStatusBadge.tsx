import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'use-intl'

const styleMap = {
  DRAFT: {
    variant: 'outline' as const,
    className: 'border-amber-500 text-amber-700 bg-amber-50',
  },
  PUBLISHED: {
    variant: 'outline' as const,
    className: 'border-emerald-500 text-emerald-700 bg-emerald-50',
  },
  ARCHIVED: {
    variant: 'outline' as const,
    className: 'border-muted-foreground/30 text-muted-foreground',
  },
} as const

export type TermsStatus = keyof typeof styleMap

export function TermsStatusBadge({ status }: { status: TermsStatus }) {
  const t = useTranslations('business.terms.status')
  const { variant, className } = styleMap[status]

  return (
    <Badge variant={variant} className={className}>
      {t(status)}
    </Badge>
  )
}
