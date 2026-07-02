import { OperatorFleetRoute, Route } from '@/routes/$locale/_business/manage/fleet/index'
import type { OperatorScope } from '@/vite/operator-context'
import {
  type OperatorFleetVehicle,
  operatorFleetQueryOptions,
  vehicleClassOptionsQueryOptions,
} from '@/vite/operator-fleet/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// The route derives its write-affordances + all-mode operator labels from
// useOperatorScope, and reads its list / class options scoped to the picked
// operator (#1264). Mock the scope hook via importOriginal SPREAD so the real
// OperatorBadge the fleet rows render survives — a bare mock makes it undefined
// and crashes the row.
const useOperatorScopeMock = vi.fn<() => OperatorScope>()

vi.mock('@/vite/operator-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-context')>()
  return { ...actual, useOperatorScope: () => useOperatorScopeMock() }
})

// The component reads `locale` via Route.useParams and the compliance deep-link
// filter via Route.useSearch (#916 §5.5), and links rows to the detail route
// (#527). This test renders it outside a RouterProvider, so stub createFileRoute
// (useParams -> a fixed locale, useSearch -> no filter) while preserving `options`
// so the loader stays testable, and Link (-> an anchor). Keep everything else real.
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  createFileRoute: () => (options: unknown) => ({
    options,
    useParams: () => ({ locale: 'en' }),
    useSearch: () => ({}),
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

const fleet = enMessages.business.vehicles.fleet
const addVehicle = fleet.addVehicle
const actionsLabel = fleet.columns.actions

function vehicle(): OperatorFleetVehicle {
  return {
    id: 'veh_1',
    operatorId: 'op-1',
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

// Seed the two queries the route reads via useSuspenseQuery so they resolve from
// cache (no fetch, no router needed), keyed to the CURRENTLY mocked scope's picked
// operator so a picked-vs-all switch hits the right key. staleTime=Infinity
// suppresses a background refetch. Mirrors OperatorClassesRoute.test.tsx (#583).
function renderRoute() {
  const { pickedOperatorId } = useOperatorScopeMock()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(operatorFleetQueryOptions(pickedOperatorId).queryKey, [vehicle()])
  queryClient.setQueryData(vehicleClassOptionsQueryOptions(pickedOperatorId).queryKey, [])
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorFleetRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('OperatorFleetRoute scope-driven affordances (#1264)', () => {
  beforeEach(() => {
    // Default: a bypass admin reading across tenants (all-mode) — read-only, and
    // every row carries its operator badge. Individual tests override as needed.
    useOperatorScopeMock.mockReturnValue({
      pickedOperatorId: undefined,
      canWrite: false,
      showOperator: true,
      operatorNameById: new Map([['op-1', 'Sakura Mobility']]),
    })
  })

  it('is read-only and labels each row with its operator in all-mode', () => {
    renderRoute()
    expect(screen.queryByRole('button', { name: addVehicle })).toBeNull()
    expect(screen.queryAllByRole('button', { name: actionsLabel })).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByText('Test Roadster')).toBeInTheDocument()
    expect(screen.getByText('Sakura Mobility')).toBeInTheDocument()
  })

  it('enables Add + per-row actions + selection when an operator is picked', () => {
    useOperatorScopeMock.mockReturnValue({
      pickedOperatorId: 'op-1',
      canWrite: true,
      showOperator: false,
      operatorNameById: new Map(),
    })
    renderRoute()
    expect(screen.getByRole('button', { name: addVehicle })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: actionsLabel }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getByText('Test Roadster')).toBeInTheDocument()
    // Scoped to one operator ⇒ no cross-tenant label.
    expect(screen.queryByText('Sakura Mobility')).toBeNull()
  })
})

const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { operator?: string | undefined }
}) => Promise<unknown>

describe('OperatorFleetRoute loader (#1264 key parity)', () => {
  it('prefetches fleet + class options scoped to the picked operator', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: 'op_9' } })
    const keys = ensureQueryData.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toContainEqual(['operator-fleet', 'op_9'])
    expect(keys).toContainEqual(['operator-fleet', 'class-options', 'op_9'])
  })

  it('defaults both reads to the shared all-scope when no operator is picked', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: undefined } })
    const keys = ensureQueryData.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toContainEqual(['operator-fleet', 'all'])
    expect(keys).toContainEqual(['operator-fleet', 'class-options', 'all'])
  })
})
