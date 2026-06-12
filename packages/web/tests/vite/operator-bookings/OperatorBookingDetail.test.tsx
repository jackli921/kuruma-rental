import type { BookingDto } from '@/vite/bookings/api'
import { OperatorBookingDetail } from '@/vite/operator-bookings/OperatorBookingDetail'
import type { OperatorBookingRow } from '@/vite/operator-bookings/api'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function makeRow(over: Partial<OperatorBookingRow> = {}): OperatorBookingRow {
  return {
    id: 'bk-1',
    bookingCode: 'H7K2M9PQ',
    status: 'CONFIRMED',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    totalPrice: 18000,
    vehicleName: 'Toyota Camry',
    renter: { id: 'r-1', name: 'Jane Renter', email: 'jane@example.com' },
    ...over,
  }
}

function makeBooking(over: Partial<BookingDto> = {}): BookingDto {
  return {
    id: 'bk-1',
    bookingCode: 'H7K2M9PQ',
    renterId: 'r-1',
    classId: 'cls-1',
    requestedVehicleId: 'v-1',
    assignedVehicleId: 'v-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    effectiveEndAt: '2026-07-03T01:00:00.000Z',
    status: 'CONFIRMED',
    source: 'DIRECT',
    insuranceOptionId: 'ins-1',
    insuranceSnapshot: {
      insuranceOptionId: 'ins-1',
      name: 'Premium',
      dailyPriceJpy: 2000,
      deductibleJpy: 50000,
    },
    feeSnapshot: [
      { feeType: 'CLEANING_FLAT', unit: 'FLAT', amountJpy: 5000, vehicleClassId: null },
    ],
    addOnSnapshot: [{ addOnId: 'ao-1', name: 'Baby seat', priceJpy: 1500 }],
    totalPrice: 18000,
    notes: 'Late arrival expected',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    ...over,
  }
}

function renderDetail(row: OperatorBookingRow, booking: BookingDto) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <OperatorBookingDetail row={row} booking={booking} locale="en" />
    </IntlProvider>,
  )
}

describe('OperatorBookingDetail', () => {
  it('shows the booking code and status label', () => {
    renderDetail(makeRow(), makeBooking())
    expect(screen.getByText('H7K2M9PQ')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
  })

  it('shows the assigned vehicle and renter from the row', () => {
    renderDetail(makeRow(), makeBooking())
    expect(screen.getByText('Toyota Camry')).toBeInTheDocument()
    expect(screen.getByText('Jane Renter')).toBeInTheDocument()
  })

  it('shows the JST pick-up and return datetimes', () => {
    renderDetail(makeRow(), makeBooking())
    // Asia/Tokyo: 01:00Z -> Jul 1 10:00; 03 Jul 01:00Z -> Jul 3 10:00
    expect(screen.getByText(/Jul 1, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Jul 3, 2026/)).toBeInTheDocument()
  })

  it('shows the insurance name, daily price, and deductible', () => {
    renderDetail(makeRow(), makeBooking())
    expect(screen.getByText(/Premium/)).toBeInTheDocument()
    expect(screen.getByText(/￥2,000/)).toBeInTheDocument()
    expect(screen.getByText('￥50,000')).toBeInTheDocument()
  })

  it('shows "Declined" when there is no insurance snapshot', () => {
    renderDetail(makeRow(), makeBooking({ insuranceSnapshot: null, insuranceOptionId: null }))
    expect(screen.getByText('Declined')).toBeInTheDocument()
  })

  it('lists each potential charge with its amount and unit', () => {
    renderDetail(makeRow(), makeBooking())
    expect(screen.getByText('Cleaning')).toBeInTheDocument()
    expect(screen.getByText(/￥5,000/)).toBeInTheDocument()
    expect(screen.getByText(/flat/)).toBeInTheDocument()
  })

  it('lists each paid add-on with its name and price', () => {
    renderDetail(makeRow(), makeBooking())
    expect(screen.getByText('Baby seat')).toBeInTheDocument()
    expect(screen.getByText('￥1,500')).toBeInTheDocument()
  })

  it('shows operator notes when present', () => {
    renderDetail(makeRow(), makeBooking())
    expect(screen.getByText('Late arrival expected')).toBeInTheDocument()
  })

  it('omits the notes block when notes is null', () => {
    renderDetail(makeRow(), makeBooking({ notes: null }))
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
  })

  it('shows the total price', () => {
    renderDetail(makeRow(), makeBooking())
    expect(screen.getByText('￥18,000')).toBeInTheDocument()
  })
})
