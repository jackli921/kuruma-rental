import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'use-intl'

// Vite port of modules/classes/ClassStatusBadge (next-intl -> use-intl). ARCHIVED
// renders muted so an owner can tell a soft-deleted class apart at a glance.
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

export function ClassStatusBadge({ status }: { status: 'ACTIVE' | 'ARCHIVED' }) {
  const t = useTranslations('business.classes.status')
  const { variant, className } = styleMap[status]
  return (
    <Badge variant={variant} className={className}>
      {t(status)}
    </Badge>
  )
}
