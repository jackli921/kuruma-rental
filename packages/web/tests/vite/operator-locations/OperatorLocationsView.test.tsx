import { OperatorLocationsView } from '@/vite/operator-locations/OperatorLocationsView'
import type { OperatorLocation } from '@/vite/operator-locations/api'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import enMessages from '../../../messages/en.json'

const en = enMessages.business.locations

function location(overrides: Partial<OperatorLocation> = {}): OperatorLocation {
  return {
    id: 'loc_1',
    operatorId: 'op_1',
    name: 'Namba Branch',
    address: '1-2-3 Namba, Chuo-ku, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderView(locations: OperatorLocation[]) {
  return render(
    <IntlProvider locale="en" messages={enMessages}>
      <OperatorLocationsView locations={locations} />
    </IntlProvider>,
  )
}

describe('OperatorLocationsView', () => {
  it('shows the empty state when there are no locations', () => {
    renderView([])
    expect(screen.getByText(en.empty)).toBeInTheDocument()
  })

  it('renders a location row with name, address, status and operating hours', () => {
    renderView([location()])
    expect(screen.getByText('Namba Branch')).toBeInTheDocument()
    expect(screen.getByText('1-2-3 Namba, Chuo-ku, Osaka')).toBeInTheDocument()
    expect(screen.getByText(en.status.ACTIVE)).toBeInTheDocument()
    // row.hours = "{open}–{close}" (en dash)
    expect(screen.getByText('09:00–20:00')).toBeInTheDocument()
  })

  it('shows "hours not set" when operatingHours is null', () => {
    renderView([location({ id: 'l2', operatingHours: null })])
    expect(screen.getByText(en.row.alwaysOpen)).toBeInTheDocument()
  })

  it('formats turnaround minutes as whole hours', () => {
    renderView([location({ id: 'l3', defaultTurnaroundMinutes: 2880 })])
    expect(screen.getByText('48h turnaround')).toBeInTheDocument()
  })

  it('renders the archived badge for an archived location', () => {
    renderView([location({ id: 'l4', status: 'ARCHIVED' })])
    expect(screen.getByText(en.status.ARCHIVED)).toBeInTheDocument()
  })

  it('renders one row per location', () => {
    renderView([location({ id: 'a', name: 'Loc A' }), location({ id: 'b', name: 'Loc B' })])
    expect(screen.getByText('Loc A')).toBeInTheDocument()
    expect(screen.getByText('Loc B')).toBeInTheDocument()
    expect(screen.getAllByTestId('location-row')).toHaveLength(2)
  })
})
