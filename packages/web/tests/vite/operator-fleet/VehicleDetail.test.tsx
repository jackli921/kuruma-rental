import { formatJpy } from '@/lib/format'
import { VehicleDetail } from '@/vite/operator-fleet/VehicleDetail'
import type { VehicleDetailResponse } from '@/vite/operator-fleet/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const detailMsg = enMessages.business.vehicles.detail
const statusLabels = enMessages.business.vehicles.fleet.status

function detail(overrides: Partial<VehicleDetailResponse> = {}): VehicleDetailResponse {
  return {
    id: 'veh_1',
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
    fuelType: 'Hybrid',
    licensePlate: 'OSAKA 1234',
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
    maintenanceLogs: [
      {
        id: 'm1',
        vehicleId: 'veh_1',
        reason: 'Oil change',
        notes: null,
        costJpy: 5000,
        startedAt: '2026-01-02T00:00:00.000Z',
        resolvedAt: '2026-01-03T00:00:00.000Z',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    upcomingBookings: [
      {
        id: 'b1',
        startAt: '2099-02-01T10:00:00.000Z',
        endAt: '2099-02-02T10:00:00.000Z',
        renterName: 'Alice Tanaka',
        source: 'DIRECT',
        status: 'CONFIRMED',
      },
    ],
    revenueLast7d: 40000,
    revenueLast30d: 120000,
    revenueAllTime: 500000,
    // 30 days, half-utilized (12h of 24h) -> avg utilization 50%.
    utilizationLast30Days: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      bookedHours: 12,
    })),
    ...overrides,
  }
}

function renderDetail(d: VehicleDetailResponse, canWrite = true, pickedOperatorId?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <VehicleDetail
          detail={d}
          locale="en"
          canWrite={canWrite}
          pickedOperatorId={pickedOperatorId}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VehicleDetail', () => {
  it('renders the vehicle identity, stats, upcoming booking and utilization', () => {
    renderDetail(detail())

    expect(screen.getByRole('heading', { name: 'Toyota Aqua' })).toBeInTheDocument()
    expect(screen.getByText(statusLabels.AVAILABLE)).toBeInTheDocument()
    expect(screen.getByText('OSAKA 1234')).toBeInTheDocument()
    // avg utilization: 12h/24h over 30 days = 50%.
    expect(screen.getByText('50%')).toBeInTheDocument()
    // revenue (last 30d) formatted as JPY.
    expect(screen.getByText(formatJpy(120000))).toBeInTheDocument()
    // upcoming booking row shows renter + source.
    expect(screen.getByText(/Alice Tanaka · DIRECT/)).toBeInTheDocument()
    expect(screen.getByText(detailMsg.utilization)).toBeInTheDocument()
  })

  it('shows the edit affordance only when the caller can write', () => {
    const { unmount } = renderDetail(detail(), true)
    expect(screen.getByRole('button', { name: detailMsg.editVehicle })).toBeInTheDocument()
    unmount()

    renderDetail(detail(), false)
    expect(screen.queryByRole('button', { name: detailMsg.editVehicle })).not.toBeInTheDocument()
  })

  it('renders a static read-only photo gallery for a non-writing caller', () => {
    renderDetail(detail({ photos: ['https://cdn.example/aqua-1.jpg'] }), false)
    const img = screen.getByRole('img', { name: /Toyota Aqua 1/ })
    expect(img).toHaveAttribute('src', 'https://cdn.example/aqua-1.jpg')
  })

  it('gives the header thumbnail (3:2) and gallery images (1:1) explicit dimensions', () => {
    renderDetail(detail({ name: 'Toyota Aqua', photos: ['a.jpg', 'b.jpg'] }), false)

    const header = screen.getByRole('img', { name: 'Toyota Aqua' })
    expect(header).toHaveAttribute('width', '300')
    expect(header).toHaveAttribute('height', '200')

    for (const name of ['Toyota Aqua 1', 'Toyota Aqua 2']) {
      const thumb = screen.getByRole('img', { name })
      expect(thumb).toHaveAttribute('width', '300')
      expect(thumb).toHaveAttribute('height', '300')
    }
  })

  it('renders the empty / zeroed state when there are no bookings or revenue', () => {
    renderDetail(
      detail({
        upcomingBookings: [],
        maintenanceLogs: [],
        revenueLast30d: 0,
        utilizationLast30Days: [],
      }),
    )

    expect(screen.getByText(detailMsg.noUpcomingBookings)).toBeInTheDocument()
    // utilization with no data -> 0%, revenue with none -> placeholder.
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('--')).toBeInTheDocument()
    expect(screen.queryByText(/Alice Tanaka/)).not.toBeInTheDocument()
  })

  it('forwards pickedOperatorId to the edit sheet; edit dropdowns scope to the VEHICLE operator (#1264)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    renderDetail(detail({ operatorId: 'op-veh' }), true, 'op-pick')
    fireEvent.click(screen.getByRole('button', { name: detailMsg.editVehicle }))

    // Edit mode ⇒ dropdowns scope to the VEHICLE's operator, not the pick.
    await waitFor(() => {
      const classCall = fetchMock.mock.calls.find(([u]) =>
        String(u).includes('/vehicle-classes/manage'),
      )
      expect(classCall).toBeDefined()
      expect(new URL(String(classCall![0]), 'http://x').searchParams.get('operatorId')).toBe(
        'op-veh',
      )
    })
  })
})
