'use client'

import { Card, CardContent } from '@/components/ui/card'
import {
  type DisplayRentalRules,
  formatDurationHours,
  hasAnyRentalRule,
} from '@/lib/rental-rules-format'
import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface RentalRulesCardProps {
  rules: DisplayRentalRules
}

/**
 * Per-vehicle rental rules surfaced to renters on the vehicle detail page
 * (#65). Renders nothing when the owner hasn't set any rules — a car with
 * no restrictions shouldn't show an empty "no rules" card that reads like
 * an error. The rules themselves are enforced by the API on POST /bookings
 * via the shared `checkRentalRules` helper, so what you see here matches
 * exactly what the server will allow.
 */
export function RentalRulesCard({ rules }: RentalRulesCardProps) {
  const t = useTranslations('vehicles.detail.rentalRules')

  if (!hasAnyRentalRule(rules)) return null

  const unitT = (key: string, values: { count: number }) => t(key, values)

  const lines: { key: string; text: string }[] = []

  if (rules.minRentalHours != null) {
    lines.push({
      key: 'min',
      text: t('minDuration', { duration: formatDurationHours(rules.minRentalHours, unitT) }),
    })
  }
  if (rules.maxRentalHours != null) {
    lines.push({
      key: 'max',
      text: t('maxDuration', { duration: formatDurationHours(rules.maxRentalHours, unitT) }),
    })
  }
  if (rules.advanceBookingHours != null) {
    lines.push({
      key: 'advance',
      text: t('advanceBooking', {
        duration: formatDurationHours(rules.advanceBookingHours, unitT),
      }),
    })
  }

  return (
    <Card>
      <CardContent className="pt-2">
        <h2 className="text-lg font-medium mb-4">{t('heading')}</h2>
        <ul className="space-y-2">
          {lines.map((line) => (
            <li key={line.key} className="flex items-start gap-2.5 text-sm">
              <Clock className="size-4 text-muted-foreground mt-0.5 shrink-0" />
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
