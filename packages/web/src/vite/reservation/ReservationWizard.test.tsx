import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import type { AvailableVehicleData } from '../storefronts/api'

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

import { ReservationWizard } from './ReservationWizard'

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
  dailyRateJpy: 5000,
  hourlyRateJpy: null,
  photos: [],
})

type Props = Parameters<typeof ReservationWizard>[0]

function renderWizard(over: Partial<Props> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <ReservationWizard
        locale="en"
        vehicle={vehicle()}
        locationId="loc_1"
        addOns={[]}
        insuranceOptions={[]}
        from={new Date('2026-07-01T01:00:00.000Z')}
        to={new Date('2026-07-04T01:00:00.000Z')}
        {...over}
      />
    </IntlProvider>,
  )
  const back = screen.getByText(en.reservation.nav.backToListing).closest('a')
  return {
    to: back?.getAttribute('data-to'),
    search: JSON.parse(back?.getAttribute('data-search') ?? 'null'),
  }
}

describe('ReservationWizard back-to-listing link', () => {
  it('returns to the storefront the renter came from, preserving the active filters', () => {
    const { to, search } = renderWizard({
      classFilter: 'SUVR',
      region: 'namba',
      pickupLocationId: 'loc_9',
    })
    expect(to).toBe('/$locale/storefronts/$locationId')
    // Dates round-trip as JST wall-clock strings; filters carry forward.
    expect(search).toMatchObject({ class: 'SUVR', region: 'namba', pickupLocationId: 'loc_9' })
    expect(typeof search.from).toBe('string')
    expect(typeof search.to).toBe('string')
  })

  it('omits filters that were never set', () => {
    const { search } = renderWizard()
    expect(search).not.toHaveProperty('class')
    expect(search).not.toHaveProperty('region')
    expect(search).not.toHaveProperty('pickupLocationId')
  })
})
