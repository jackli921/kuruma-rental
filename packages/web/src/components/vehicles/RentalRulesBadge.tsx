'use client'

import {
  type DisplayRentalRules,
  formatDurationHours,
  pickPrimaryRentalRule,
} from '@/lib/rental-rules-format'
import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface RentalRulesBadgeProps {
  rules: DisplayRentalRules
}

/**
 * Compact badge shown on the renter vehicle list card (#65) when a car has
 * at least one rental rule set. Dumping all three rules clutters the card,
 * so we pick the single "most likely to surprise" rule via
 * `pickPrimaryRentalRule` — the rest are still visible on the detail page.
 * Renders nothing when no rules are set (most cars won't have any).
 */
export function RentalRulesBadge({ rules }: RentalRulesBadgeProps) {
  // Pull duration keys from the detail namespace so there's one source of
  // truth for "4 hours" / "3 days" formatting between badge, card, and
  // booking form.
  const detailT = useTranslations('vehicles.detail.rentalRules')
  const cardT = useTranslations('vehicles.card.rentalRule')

  const primary = pickPrimaryRentalRule(rules)
  if (!primary) return null

  const unitT = (key: string, values: { count: number }) => detailT(key, values)
  const duration = formatDurationHours(primary.hours, unitT)
  const text = cardT(primary.code, { duration })

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <Clock className="size-3" />
      {text}
    </span>
  )
}
