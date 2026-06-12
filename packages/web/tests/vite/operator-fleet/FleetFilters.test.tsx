import type { FleetFilterState } from '@/lib/fleet-filters'
import { filterVehicles } from '@/lib/fleet-filters'
import { FleetFilters } from '@/vite/operator-fleet/FleetFilters'
import type { OperatorFleetVehicle } from '@/vite/operator-fleet/api'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const filter = enMessages.business.vehicles.filter
const status = enMessages.business.vehicles.status

function vehicle(overrides: Partial<OperatorFleetVehicle> = {}): OperatorFleetVehicle {
  return {
    id: crypto.randomUUID(),
    operatorId: 'op_1',
    classId: null,
    pickupLocationId: null,
    name: 'Toyota Aqua',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'なにわ 300 あ 12-34',
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Aqua',
    year: 2022,
    color: null,
    dailyRateJpy: 6800,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-01-01',
    insuranceExpiryDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
    ...overrides,
  }
}

function renderFilters(
  vehicles: OperatorFleetVehicle[],
  value: FleetFilterState,
  onChange = vi.fn(),
) {
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <FleetFilters vehicles={vehicles} value={value} onChange={onChange} />
    </IntlProvider>,
  )
  return onChange
}

describe('FleetFilters', () => {
  describe('rendering the active value', () => {
    it('shows the search box populated from value.search', () => {
      renderFilters([vehicle()], { search: 'prius' })
      const input = screen.getByPlaceholderText(filter.searchPlaceholder) as HTMLInputElement
      expect(input.value).toBe('prius')
    })

    it('marks a selected status badge as pressed and others as not', () => {
      renderFilters([vehicle({ status: 'AVAILABLE' }), vehicle({ status: 'MAINTENANCE' })], {
        statuses: ['MAINTENANCE'],
      })
      const available = screen.getByRole('button', { name: new RegExp(status.AVAILABLE) })
      const maintenance = screen.getByRole('button', { name: new RegExp(status.MAINTENANCE) })
      expect(available).toHaveAttribute('aria-pressed', 'false')
      expect(maintenance).toHaveAttribute('aria-pressed', 'true')
    })

    it('marks the expiring-soon toggle pressed when value.expiringSoon is true', () => {
      renderFilters([vehicle()], { expiringSoon: true })
      const toggle = screen.getByRole('button', { name: new RegExp(filter.expiringSoonLabel) })
      expect(toggle).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('facet counts derived from vehicles', () => {
    it('labels each status badge with the count of matching vehicles', () => {
      const vehicles = [
        vehicle({ status: 'AVAILABLE' }),
        vehicle({ status: 'AVAILABLE' }),
        vehicle({ status: 'MAINTENANCE' }),
      ]
      renderFilters(vehicles, {})

      const availableCount = filterVehicles(vehicles, { statuses: ['AVAILABLE'] }).length
      const maintenanceCount = filterVehicles(vehicles, { statuses: ['MAINTENANCE'] }).length
      expect(availableCount).toBe(2)
      expect(maintenanceCount).toBe(1)

      expect(
        screen.getByRole('button', { name: `${status.AVAILABLE} (${availableCount})` }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: `${status.MAINTENANCE} (${maintenanceCount})` }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `${status.RETIRED} (0)` })).toBeInTheDocument()
    })

    it('counts transmissions through the real filter predicate', () => {
      const vehicles = [
        vehicle({ transmission: 'AUTO' }),
        vehicle({ transmission: 'AUTO' }),
        vehicle({ transmission: 'MANUAL' }),
      ]
      renderFilters(vehicles, {})

      const autoCount = filterVehicles(vehicles, { transmissions: ['AUTO'] }).length
      expect(autoCount).toBe(2)
      expect(
        screen.getByRole('button', { name: `${filter.transmissionAuto} (${autoCount})` }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: `${filter.transmissionManual} (1)` }),
      ).toBeInTheDocument()
    })
  })

  describe('emitting updated state via onChange', () => {
    it('emits search text, replacing the previous value', () => {
      const onChange = renderFilters([vehicle()], { search: 'old', statuses: ['AVAILABLE'] })
      const input = screen.getByPlaceholderText(filter.searchPlaceholder)
      fireEvent.change(input, { target: { value: 'leaf' } })
      expect(onChange).toHaveBeenCalledWith({ search: 'leaf', statuses: ['AVAILABLE'] })
    })

    it('emits undefined search when the box is cleared', () => {
      const onChange = renderFilters([vehicle()], { search: 'leaf' })
      const input = screen.getByPlaceholderText(filter.searchPlaceholder)
      fireEvent.change(input, { target: { value: '' } })
      expect(onChange).toHaveBeenCalledWith({ search: undefined })
    })

    it('adds a status to an empty selection when toggled on', () => {
      const onChange = renderFilters([vehicle()], {})
      fireEvent.click(screen.getByRole('button', { name: new RegExp(status.MAINTENANCE) }))
      expect(onChange).toHaveBeenCalledWith({ statuses: ['MAINTENANCE'] })
    })

    it('removes a status from the selection when toggled off', () => {
      const onChange = renderFilters([vehicle()], {
        statuses: ['AVAILABLE', 'MAINTENANCE'],
      })
      fireEvent.click(screen.getByRole('button', { name: new RegExp(status.AVAILABLE) }))
      expect(onChange).toHaveBeenCalledWith({ statuses: ['MAINTENANCE'] })
    })

    it('toggles a transmission into the selection', () => {
      const onChange = renderFilters(
        [vehicle({ transmission: 'AUTO' }), vehicle({ transmission: 'MANUAL' })],
        {},
      )
      fireEvent.click(screen.getByRole('button', { name: new RegExp(filter.transmissionManual) }))
      expect(onChange).toHaveBeenCalledWith({ transmissions: ['MANUAL'] })
    })

    it('toggles a seats facet, preserving unrelated filters', () => {
      const onChange = renderFilters([vehicle({ seats: 4 }), vehicle({ seats: 8 })], {
        search: 'a',
      })
      fireEvent.click(screen.getByRole('button', { name: /8 seats/ }))
      expect(onChange).toHaveBeenCalledWith({ search: 'a', seats: [8] })
    })

    it('toggles a make facet', () => {
      const onChange = renderFilters([vehicle({ make: 'Toyota' }), vehicle({ make: 'Honda' })], {})
      fireEvent.click(screen.getByRole('button', { name: /Honda/ }))
      expect(onChange).toHaveBeenCalledWith({ makes: ['Honda'] })
    })

    it('flips the expiring-soon toggle on', () => {
      const onChange = renderFilters([vehicle()], { statuses: ['AVAILABLE'] })
      fireEvent.click(screen.getByRole('button', { name: new RegExp(filter.expiringSoonLabel) }))
      expect(onChange).toHaveBeenCalledWith({ statuses: ['AVAILABLE'], expiringSoon: true })
    })
  })

  describe('facet visibility', () => {
    it('hides single-value facet sections (only one make → no make section)', () => {
      renderFilters([vehicle({ make: 'Toyota' }), vehicle({ make: 'Toyota' })], {})
      expect(screen.queryByText(filter.makeHeading)).not.toBeInTheDocument()
    })

    it('shows a facet section when more than one distinct value exists', () => {
      renderFilters([vehicle({ make: 'Toyota' }), vehicle({ make: 'Honda' })], {})
      expect(screen.getByText(filter.makeHeading)).toBeInTheDocument()
    })
  })
})
