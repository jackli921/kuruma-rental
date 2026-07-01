import { Badge } from '@/components/ui/badge'
import { useTranslations } from 'use-intl'

interface OperatorBadgeProps {
  /** Operator label for cross-tenant (all-mode) reads; undefined hides the badge. */
  name?: string | undefined
}

// Per-operator label shown on config rows when a platform admin reads across
// tenants. The aria-label is localized (not a hardcoded "Operator:" prefix) so
// ja/zh screen-reader users don't get an English announcement — the product's
// core users are international tourists. Centralized here so the four config
// surfaces (add-ons, fees, insurance, locations) localize the badge once.
export function OperatorBadge({ name }: OperatorBadgeProps) {
  const t = useTranslations('business.operatorContext')
  if (!name) return null
  return (
    <Badge variant="secondary" aria-label={t('badge', { name })}>
      {name}
    </Badge>
  )
}
