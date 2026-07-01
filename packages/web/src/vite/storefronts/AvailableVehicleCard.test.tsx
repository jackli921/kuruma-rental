import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import type { AvailableVehicleData } from './api'

// Capture the booking CTA's destination + search so filter carry-forward can be
// asserted without a RouterProvider (repo test pattern).
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

import { AvailableVehicleCard } from './AvailableVehicleCard'

// classId + prices null so the class-rating line and the currency note (which
// pull query/currency hooks) don't render — this test is about the booking CTA.
const vehicle = (): AvailableVehicleData => ({
  id: 'veh_1',
  classId: null,
  name: 'Test Car',
  make: null,
  model: null,
  year: null,
  seats: 4,
  luggageCapacity: null,
  luggageSize: null,
  transmission: 'AUTO',
  acrissCode: null,
  classLabel: '',
  dailyRateJpy: null,
  hourlyRateJpy: null,
  photos: [],
})

type Props = Parameters<typeof AvailableVehicleCard>[0]

function renderCard(over: Partial<Props> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <AvailableVehicleCard
        vehicle={vehicle()}
        locationId="loc_1"
        from="2026-07-01T10:00"
        to="2026-07-04T10:00"
        {...over}
      />
    </IntlProvider>,
  )
  const cta = screen.getByText(en.search.detail.book).closest('a')
  return JSON.parse(cta?.getAttribute('data-search') ?? 'null')
}

describe('AvailableVehicleCard booking CTA', () => {
  it('always carries the vehicle, location and dates into the wizard', () => {
    const search = renderCard()
    expect(search).toMatchObject({
      vehicleId: 'veh_1',
      locationId: 'loc_1',
      from: '2026-07-01T10:00',
      to: '2026-07-04T10:00',
    })
  })

  it('carries the active class/region/pickup filters forward so they survive booking', () => {
    const search = renderCard({
      classFilter: 'SUVR',
      region: 'namba',
      pickupLocationId: 'loc_9',
    })
    expect(search).toMatchObject({ class: 'SUVR', region: 'namba', pickupLocationId: 'loc_9' })
  })

  it('omits empty filters so the URL stays clean', () => {
    const search = renderCard({ classFilter: '', region: undefined })
    expect(search).not.toHaveProperty('class')
    expect(search).not.toHaveProperty('region')
    expect(search).not.toHaveProperty('pickupLocationId')
  })
})
