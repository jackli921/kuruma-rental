import { formatJpy } from '@/lib/format'
import type { CustomerWithBookings } from '@kuruma/shared/types/customer'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { CustomerDetailDrawer } from './CustomerDetailDrawer'

const detail: CustomerWithBookings = {
  id: 'usr_1',
  name: 'Aiko Tanaka',
  email: 'aiko@example.com',
  language: 'ja',
  country: 'JP',
  bookingCount: 1,
  lastBookingAt: '2026-06-01T09:00:00.000Z',
  totalSpent: 16000,
  bookings: [
    {
      id: 'bk_1',
      vehicleId: 'veh_1',
      vehicleName: 'Toyota Aqua',
      startAt: '2026-06-01T09:00:00.000Z',
      endAt: '2026-06-03T09:00:00.000Z',
      status: 'COMPLETED',
      totalPrice: 12000,
    },
  ],
}

function renderDrawer(props: Partial<Parameters<typeof CustomerDetailDrawer>[0]> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <CustomerDetailDrawer
        customer={detail}
        open
        isLoading={false}
        onOpenChange={vi.fn()}
        {...props}
      />
    </IntlProvider>,
  )
}

describe('CustomerDetailDrawer', () => {
  it('renders the booking history with vehicle, status and price when open', () => {
    renderDrawer()
    expect(screen.queryByText('Toyota Aqua')).not.toBeNull()
    expect(screen.queryByText(en.admin.customers.status.COMPLETED)).not.toBeNull()
    // Booking line price (distinct from the lifetime "total spent" stat).
    expect(screen.queryByText(formatJpy(12000))).not.toBeNull()
    // Lifetime total in the profile stats.
    expect(screen.queryByText(formatJpy(16000))).not.toBeNull()
  })

  it('shows the loading line while the detail read is in flight', () => {
    renderDrawer({ customer: null, isLoading: true })
    expect(screen.queryByText(en.admin.customers.detailLoading)).not.toBeNull()
    expect(screen.queryByText('Toyota Aqua')).toBeNull()
  })

  it('shows the empty state when the lookup resolved to a deleted customer', () => {
    renderDrawer({ customer: null, isLoading: false })
    expect(screen.queryByText(en.admin.customers.detailEmpty)).not.toBeNull()
  })
})
