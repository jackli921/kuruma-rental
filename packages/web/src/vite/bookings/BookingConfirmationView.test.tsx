import type { VehicleClassData } from '@/vite/vehicles/classes'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import type { RenterBookingDetail } from './api'

// Render the pure presentational view without a RouterProvider / currency fetch /
// runtime flag layer: the pre/post-assign rows are the unit under test.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#link">{children}</a>,
}))
vi.mock('@/vite/config', () => ({ useFeatureFlag: () => false }))
vi.mock('@/vite/currency', () => ({
  useIndicative: () => ({ currency: 'JPY', format: () => null }),
  IndicativeNote: () => null,
}))

import { BookingConfirmationView } from './BookingConfirmationView'

const baseBooking: RenterBookingDetail = {
  id: '00000000-0000-0000-0000-000000000001',
  bookingCode: 'KRM-0001',
  renterId: '00000000-0000-0000-0000-000000000002',
  classId: '00000000-0000-0000-0000-000000000099',
  requestedVehicleId: null,
  assignedVehicleId: null,
  pickupLocationId: '00000000-0000-0000-0000-000000000020',
  dropoffLocationId: '00000000-0000-0000-0000-000000000020',
  startAt: '2026-07-01T09:00:00.000Z',
  endAt: '2026-07-03T09:00:00.000Z',
  effectiveEndAt: '2026-07-03T09:00:00.000Z',
  status: 'CONFIRMED',
  source: 'WEB',
  insuranceOptionId: null,
  insuranceSnapshot: null,
  feeSnapshot: [],
  addOnSnapshot: [],
  totalPrice: null,
  notes: null,
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
}

const economyClass: VehicleClassData = {
  id: '00000000-0000-0000-0000-000000000099',
  operatorId: '00000000-0000-0000-0000-000000000003',
  name: 'Economy',
  slug: 'economy',
  description: null,
  photos: [],
  seats: 4,
  luggageCapacity: 2,
  luggageSize: 'MEDIUM',
  transmission: 'AUTO',
  fuelType: null,
  acrissCode: null,
  sortOrder: 0,
  status: 'ACTIVE',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
}

function renderView(booking: RenterBookingDetail, vehicleClass: VehicleClassData | null) {
  render(
    <IntlProvider locale="en" messages={en}>
      <BookingConfirmationView
        booking={booking}
        vehicleClass={vehicleClass}
        csrfToken={null}
        threadId={null}
      />
    </IntlProvider>,
  )
}

describe('BookingConfirmationView — #464 class-combo float pre/post assign', () => {
  it('pre-assign: shows the class label and the assignment note, not a concrete car', () => {
    renderView(baseBooking, economyClass)

    expect(screen.getByText(en.bookings.confirmation.vehicleClass)).toBeTruthy()
    expect(screen.getByText('Economy')).toBeTruthy()
    expect(screen.getByText(en.bookings.confirmation.assignmentNote)).toBeTruthy()
    // No concrete-vehicle row until the operator assigns.
    expect(screen.queryByText(en.bookings.confirmation.vehicle)).toBeNull()
  })

  it('post-assign: shows the assigned car name and drops the assignment note', () => {
    const assigned: RenterBookingDetail = {
      ...baseBooking,
      assignedVehicleId: '00000000-0000-0000-0000-000000000010',
      vehicle: { name: 'Toyota Aqua Hybrid', photos: [] },
    }
    renderView(assigned, economyClass)

    expect(screen.getByText(en.bookings.confirmation.vehicle)).toBeTruthy()
    expect(screen.getByText('Toyota Aqua Hybrid')).toBeTruthy()
    expect(screen.queryByText(en.bookings.confirmation.assignmentNote)).toBeNull()
  })
})
