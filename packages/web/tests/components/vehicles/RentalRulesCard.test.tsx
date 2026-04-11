import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The card uses next-intl with ICU parameters. Mock the hook so tests
// don't need a full IntlProvider, and keep the messages close to the real
// en.json so we catch key-name drift.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    const count = Number(values?.count ?? 0)
    const duration = String(values?.duration ?? '')
    const messages: Record<string, string> = {
      heading: 'Rental rules',
      minDuration: `Minimum rental: ${duration}`,
      maxDuration: `Maximum rental: ${duration}`,
      advanceBooking: `Book at least ${duration} in advance`,
      hours: count === 1 ? `${count} hour` : `${count} hours`,
      days: count === 1 ? `${count} day` : `${count} days`,
    }
    return messages[key] ?? key
  },
}))

import { RentalRulesCard } from '@/components/vehicles/RentalRulesCard'

describe('RentalRulesCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders nothing when all three rules are null', () => {
    const { container } = render(
      <RentalRulesCard
        rules={{
          minRentalHours: null,
          maxRentalHours: null,
          advanceBookingHours: null,
        }}
      />,
    )
    // Entire component tree is empty — no heading, no card chrome.
    expect(container.firstChild).toBeNull()
  })

  it('renders only the minimum rule line when only min is set', () => {
    render(
      <RentalRulesCard
        rules={{
          minRentalHours: 4,
          maxRentalHours: null,
          advanceBookingHours: null,
        }}
      />,
    )

    expect(screen.getByText('Rental rules')).toBeInTheDocument()
    expect(screen.getByText('Minimum rental: 4 hours')).toBeInTheDocument()
    expect(screen.queryByText(/Maximum rental/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Book at least/)).not.toBeInTheDocument()
  })

  it('formats 72 hours as "3 days" on the maximum line', () => {
    render(
      <RentalRulesCard
        rules={{
          minRentalHours: null,
          maxRentalHours: 72,
          advanceBookingHours: null,
        }}
      />,
    )

    expect(screen.getByText('Maximum rental: 3 days')).toBeInTheDocument()
  })

  it('formats 24 hours as "1 day" on the advance-booking line', () => {
    render(
      <RentalRulesCard
        rules={{
          minRentalHours: null,
          maxRentalHours: null,
          advanceBookingHours: 24,
        }}
      />,
    )

    expect(screen.getByText('Book at least 1 day in advance')).toBeInTheDocument()
  })

  it('renders all three rule lines when all three are set (Alphard case)', () => {
    render(
      <RentalRulesCard
        rules={{
          minRentalHours: 6,
          maxRentalHours: 240,
          advanceBookingHours: 24,
        }}
      />,
    )

    expect(screen.getByText('Rental rules')).toBeInTheDocument()
    expect(screen.getByText('Minimum rental: 6 hours')).toBeInTheDocument()
    expect(screen.getByText('Maximum rental: 10 days')).toBeInTheDocument()
    expect(screen.getByText('Book at least 1 day in advance')).toBeInTheDocument()
  })
})
