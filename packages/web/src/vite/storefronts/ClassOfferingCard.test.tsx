import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import type { ClassOfferingData } from './api'

// Capture the class-deal CTA's destination + search so filter carry-forward can
// be asserted without a RouterProvider (mirrors AvailableVehicleCard.test).
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
  }: { children: ReactNode; to?: string; search?: Record<string, unknown> }) => (
    <a href="#link" data-to={to} data-search={JSON.stringify(search ?? null)}>
      {children}
    </a>
  ),
}))

import { ClassOfferingCard } from './ClassOfferingCard'

// prices null so IndicativeNote (which pulls the currency hook) doesn't render —
// this test is about the booking CTA, not the price line.
const offering = (): ClassOfferingData => ({
  kind: 'CLASS_COMBO',
  location: {
    locationId: 'loc_1',
    operatorId: 'op_1',
    operatorName: 'Osaka Cars',
    name: 'Namba Store',
    address: '1-1 Namba',
    latitude: null,
    longitude: null,
  },
  dailyRateJpy: null,
  hourlyRateJpy: null,
  classLabel: 'Economy',
  acrissCode: null,
  seats: 4,
  photos: [],
  classId: 'class_1',
  availableCount: 2,
})

type Props = Parameters<typeof ClassOfferingCard>[0]

function renderCard(over: Partial<Props> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <ClassOfferingCard
        offering={offering()}
        locationId="loc_1"
        from="2026-07-01T10:00"
        to="2026-07-04T10:00"
        {...over}
      />
    </IntlProvider>,
  )
  const cta = screen.getByText(en.search.detail.bookClass).closest('a')
  return JSON.parse(cta?.getAttribute('data-search') ?? 'null')
}

describe('ClassOfferingCard booking CTA', () => {
  it('carries the class, location and dates into the wizard — and no vehicleId', () => {
    const search = renderCard()
    expect(search).toMatchObject({
      classId: 'class_1',
      locationId: 'loc_1',
      from: '2026-07-01T10:00',
      to: '2026-07-04T10:00',
    })
    // A class-combo has no assigned car; the wizard resolves the class, not a car.
    expect(search).not.toHaveProperty('vehicleId')
  })

  it('carries the active class/region/pickup filters forward so they survive booking', () => {
    const search = renderCard({ classFilter: 'SUVR', region: 'namba', pickupLocationId: 'loc_9' })
    expect(search).toMatchObject({ class: 'SUVR', region: 'namba', pickupLocationId: 'loc_9' })
  })

  it('omits empty filters so the URL stays clean', () => {
    const search = renderCard({ classFilter: '', region: undefined })
    expect(search).not.toHaveProperty('class')
    expect(search).not.toHaveProperty('region')
    expect(search).not.toHaveProperty('pickupLocationId')
  })
})
