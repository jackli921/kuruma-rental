import { ClassOfferingCard } from '@/vite/storefronts/ClassOfferingCard'
import type { ClassOfferingData } from '@/vite/storefronts/api'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    className,
    children,
  }: {
    to: string
    params?: { locale?: string }
    search?: {
      classId?: string
      vehicleId?: string
      locationId?: string
      from?: string
      to?: string
    }
    className?: string
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-class={search?.classId}
      data-vehicle={search?.vehicleId}
      data-location={search?.locationId}
      data-from={search?.from}
      data-rangeto={search?.to}
      className={className}
    >
      {children}
    </a>
  ),
}))

function makeOffering(overrides: Partial<ClassOfferingData> = {}): ClassOfferingData {
  return {
    kind: 'CLASS_COMBO',
    location: {
      locationId: 'loc-1',
      operatorId: 'op-best',
      operatorName: 'Best Car Rental',
      name: 'Best Car Rental Osaka',
      address: '1-2-3 Namba, Osaka',
      latitude: null,
      longitude: null,
    },
    dailyRateJpy: 9000,
    hourlyRateJpy: null,
    classLabel: 'Compact',
    acrissCode: 'CCAR',
    seats: 5,
    photos: [],
    classId: 'cls-compact',
    availableCount: 3,
    ...overrides,
  }
}

function renderCard(offering: ClassOfferingData = makeOffering()) {
  render(
    <IntlProvider locale="en" messages={en}>
      <ClassOfferingCard
        offering={offering}
        locationId="loc-1"
        from="2026-07-01T10:00"
        to="2026-07-03T10:00"
      />
    </IntlProvider>,
  )
}

describe('ClassOfferingCard', () => {
  it('renders the class label, seats, availability count, daily price, and the class-deal badge', () => {
    renderCard()
    expect(screen.getByText('Compact')).toBeInTheDocument()
    expect(screen.getByText('5 seats')).toBeInTheDocument()
    expect(screen.getByText('3 available')).toBeInTheDocument()
    expect(screen.getByText('From ¥9,000 / day')).toBeInTheDocument()
    expect(screen.getByText('Class deal')).toBeInTheDocument()
  })

  it('links the CTA to the wizard carrying classId, location, and dates — never a vehicleId', () => {
    renderCard()
    const book = screen.getByRole('link', { name: /book/i })
    expect(book).toHaveAttribute('data-to', '/$locale/bookings/new')
    expect(book).toHaveAttribute('data-locale', 'en')
    expect(book).toHaveAttribute('data-class', 'cls-compact')
    expect(book).toHaveAttribute('data-location', 'loc-1')
    expect(book).toHaveAttribute('data-from', '2026-07-01T10:00')
    expect(book).toHaveAttribute('data-rangeto', '2026-07-03T10:00')
    // A class deal has no assigned car yet — the link must never carry a vehicleId.
    expect(book).not.toHaveAttribute('data-vehicle')
  })

  it('falls back to the hourly rate label when no daily rate is set', () => {
    renderCard(makeOffering({ dailyRateJpy: null, hourlyRateJpy: 1200 }))
    expect(screen.getByText('From ¥1,200 / hour')).toBeInTheDocument()
  })

  it('renders a single-car availability label when only one remains', () => {
    renderCard(makeOffering({ availableCount: 1 }))
    expect(screen.getByText('1 available')).toBeInTheDocument()
  })
})
