import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The badge reads from two nested namespaces. Mock useTranslations so each
// namespace returns its own table and we catch key-name drift the same
// way the real next-intl would at runtime.
vi.mock('next-intl', () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
      const count = Number(values?.count ?? 0)
      const duration = String(values?.duration ?? '')
      if (namespace === 'vehicles.detail.rentalRules') {
        if (key === 'hours') return count === 1 ? `${count} hour` : `${count} hours`
        if (key === 'days') return count === 1 ? `${count} day` : `${count} days`
      }
      if (namespace === 'vehicles.card.rentalRule') {
        if (key === 'advance') return `${duration} advance`
        if (key === 'min') return `Min ${duration}`
        if (key === 'max') return `Max ${duration}`
      }
      return key
    },
}))

import { RentalRulesBadge } from '@/components/vehicles/RentalRulesBadge'

describe('RentalRulesBadge', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders nothing when no rules are set', () => {
    const { container } = render(
      <RentalRulesBadge
        rules={{
          minRentalHours: null,
          maxRentalHours: null,
          advanceBookingHours: null,
        }}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('prefers the advance-booking rule when all three are set', () => {
    render(
      <RentalRulesBadge
        rules={{
          minRentalHours: 4,
          maxRentalHours: 72,
          advanceBookingHours: 24,
        }}
      />,
    )
    expect(screen.getByText('1 day advance')).toBeInTheDocument()
  })

  it('falls back to min when advance is null', () => {
    render(
      <RentalRulesBadge
        rules={{
          minRentalHours: 4,
          maxRentalHours: 72,
          advanceBookingHours: null,
        }}
      />,
    )
    expect(screen.getByText('Min 4 hours')).toBeInTheDocument()
  })

  it('falls back to max when only max is set', () => {
    render(
      <RentalRulesBadge
        rules={{
          minRentalHours: null,
          maxRentalHours: 120,
          advanceBookingHours: null,
        }}
      />,
    )
    expect(screen.getByText('Max 5 days')).toBeInTheDocument()
  })
})
