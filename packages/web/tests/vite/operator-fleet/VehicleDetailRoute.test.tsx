import { VehicleDetailRoute } from '@/routes/$locale/_business/manage/fleet/$vehicleId'
import type { VehicleDetailResponse } from '@/vite/operator-fleet/api'
import { vehicleDetailQueryOptions } from '@/vite/operator-fleet/api'
import type { Session } from '@/vite/session'
import { sessionQueryOptions } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// This route derives its Edit affordance as
// `canWriteAsOperator(session, pickedOperatorId)` (#1264): a picker-admin who has
// chosen an operator may now edit; with no pick they stay read-only. That wiring
// of session + pickedOperatorId -> canWrite -> VehicleDetail is what we pin here.
// (canWriteAsOperator's truth table lives in guards.test.ts; VehicleDetail's
// canWrite -> Edit gating lives in VehicleDetail.test.tsx — not re-tested here.)
const useOperatorContextMock = vi.fn<() => { pickedOperatorId: string | undefined }>()

// Spread the real module so OperatorBadge / other exports the render path may reach
// survive — a bare mock makes them undefined and crashes the render.
vi.mock('@/vite/operator-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-context')>()
  return { ...actual, useOperatorContext: () => useOperatorContextMock() }
})

// The route reads `locale` + `vehicleId` via Route.useParams and links back to the
// fleet list. Rendered outside a RouterProvider, so stub createFileRoute (useParams
// -> fixed locale + vehicleId) while preserving `options`, and Link -> an anchor.
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ locale: 'en', vehicleId: 'veh_1' }),
  }),
  Link: ({
    to,
    params: _params,
    children,
    ...rest
  }: { to: string; params?: unknown; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const detailMsg = enMessages.business.vehicles.detail

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
    maintenanceLogs: [],
    upcomingBookings: [],
    revenueLast7d: 0,
    revenueLast30d: 0,
    revenueAllTime: 0,
    utilizationLast30Days: [],
    ...overrides,
  }
}

// A cross-tenant bypass admin: no operatorId, so isOperatorSession is false and the
// Edit gate depends entirely on whether a pick is present (the #1264 behavior).
const platformAdminSession: Session = {
  user: { id: 'u', role: 'PLATFORM_ADMIN' },
  csrfToken: 't',
}

function renderRoute(session: Session, pickedOperatorId: string | undefined) {
  useOperatorContextMock.mockReturnValue({ pickedOperatorId })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(vehicleDetailQueryOptions('veh_1').queryKey, detail())
  queryClient.setQueryData(sessionQueryOptions().queryKey, session)
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <VehicleDetailRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('VehicleDetailRoute write gate (#1264)', () => {
  it('shows Edit to a picker-admin who has chosen an operator', () => {
    renderRoute(platformAdminSession, 'op_1')
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: detailMsg.editVehicle })).toBeInTheDocument()
  })

  it('stays read-only for a picker-admin with no operator picked', () => {
    renderRoute(platformAdminSession, undefined)
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: detailMsg.editVehicle })).not.toBeInTheDocument()
  })

  it('shows Edit to a real operator session even with no pick', () => {
    const operatorOwnerSession: Session = {
      user: { id: 'u2', role: 'OPERATOR_OWNER', operatorId: 'op_1' },
      csrfToken: 't',
    }
    renderRoute(operatorOwnerSession, undefined)
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: detailMsg.editVehicle })).toBeInTheDocument()
  })
})
