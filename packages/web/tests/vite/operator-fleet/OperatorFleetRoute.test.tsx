import { OperatorFleetRoute } from '@/routes/$locale/_business/manage/fleet'
import {
  type OperatorFleetVehicle,
  operatorFleetQueryOptions,
  vehicleClassOptionsQueryOptions,
} from '@/vite/operator-fleet/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import enMessages from '../../../messages/en.json'

const fleet = enMessages.business.vehicles.fleet
const addVehicle = fleet.addVehicle
const actionsLabel = fleet.columns.actions

function vehicle(): OperatorFleetVehicle {
  return {
    id: 'veh_1',
    operatorId: 'op_1',
    classId: null,
    pickupLocationId: null,
    name: 'Test Roadster',
    description: null,
    photos: [],
    seats: 4,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 1234',
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
  }
}

const operatorSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: 'op_1', operatorSlug: 'acme' },
  csrfToken: 't',
}

const bypassSession: Session = {
  user: { id: 'u', role: 'PLATFORM_ADMIN' },
  csrfToken: 't',
}

// Seed the three queries the route reads via useSuspenseQuery so they resolve
// from cache (no fetch, no router needed). staleTime=Infinity suppresses a
// background refetch. Mirrors OperatorClassesRoute.test.tsx (#583).
function renderRoute(session: Session) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(['session'], session)
  queryClient.setQueryData(operatorFleetQueryOptions().queryKey, [vehicle()])
  queryClient.setQueryData(vehicleClassOptionsQueryOptions().queryKey, [])
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorFleetRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorFleetRoute write-affordance gating (#598)', () => {
  it('shows Add + per-row actions + selection for a tenant-scoped operator session', () => {
    renderRoute(operatorSession)
    expect(screen.getByRole('button', { name: addVehicle })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: actionsLabel }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getByText('Test Roadster')).toBeInTheDocument()
  })

  it('hides Add + per-row actions + selection for a bypass role with no operatorId, but still lists the fleet (read-only oversight)', () => {
    renderRoute(bypassSession)
    expect(screen.queryByRole('button', { name: addVehicle })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: actionsLabel })).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByText('Test Roadster')).toBeInTheDocument()
  })
})
