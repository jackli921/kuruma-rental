import type { BookingDto } from '@/vite/bookings/api'
import { OperatorBookingDetailSheet } from '@/vite/operator-bookings/OperatorBookingDetailSheet'
import type { OperatorBookingRow } from '@/vite/operator-bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The base-ui Sheet is a portal-backed dialog that is flaky to open in happy-dom,
// so replace it with a passthrough (mirrors MobileMenu.test). The drawer's own
// `{row != null && <DetailBody/>}` gate still controls whether the body mounts.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// Control the single-booking fetch per test without touching the network.
const queryFn = vi.fn()
vi.mock('@/vite/bookings/api', () => ({
  bookingByIdQueryOptions: (id: string) => ({ queryKey: ['bookings', id], queryFn }),
}))

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

function makeBooking(): BookingDto {
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
    feeSnapshot: [],
    addOnSnapshot: [],
    totalPrice: 18000,
    notes: null,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  }
}

function renderSheet(row: OperatorBookingRow | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <OperatorBookingDetailSheet row={row} locale="en" onClose={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorBookingDetailSheet', () => {
  beforeEach(() => {
    queryFn.mockReset()
  })

  it('shows a loading message while the booking is being fetched', () => {
    queryFn.mockReturnValue(new Promise(() => {})) // never resolves -> stays pending
    renderSheet(makeRow())
    expect(screen.getByText('Loading booking…')).toBeInTheDocument()
  })

  it('shows an error message when the fetch rejects', async () => {
    queryFn.mockRejectedValue(new Error('boom'))
    renderSheet(makeRow())
    await waitFor(() => expect(screen.getByText("Couldn't load this booking")).toBeInTheDocument())
  })

  it('shows a not-found message when the booking resolves to null', async () => {
    queryFn.mockResolvedValue(null)
    renderSheet(makeRow())
    await waitFor(() => expect(screen.getByText('Booking not found')).toBeInTheDocument())
  })

  it('renders the detail panel once the booking loads', async () => {
    queryFn.mockResolvedValue(makeBooking())
    renderSheet(makeRow())
    await waitFor(() => expect(screen.getByText('H7K2M9PQ')).toBeInTheDocument())
    expect(screen.getByText(/Premium/)).toBeInTheDocument()
    expect(screen.getByText('Toyota Camry')).toBeInTheDocument()
  })

  it('does not fetch when no row is selected (drawer closed)', () => {
    renderSheet(null)
    expect(queryFn).not.toHaveBeenCalled()
    expect(screen.queryByText('Loading booking…')).not.toBeInTheDocument()
  })
})
