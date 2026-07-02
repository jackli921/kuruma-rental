import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { FleetGrid } from './FleetGrid'
import { FleetTable } from './FleetTable'
import type { OperatorFleetVehicle } from './api'

// The row/card link the vehicle name to its detail page; stub the router Link so
// the pure view renders without a RouterProvider (repo test pattern). importOriginal
// SPREAD keeps getRouteApi real — the rows now render OperatorBadge from the
// operator-context barrel, which loads a getRouteApi at module scope (#1264).
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: ReactNode }) => <a href="#vehicle">{children}</a>,
}))

// The visible Edit affordance reuses the same "Edit vehicle" copy the kebab menu
// and detail page already use, so the accessible name is a shared constant.
const EDIT_LABEL = en.business.vehicles.editVehicle

function makeVehicle(over: Partial<OperatorFleetVehicle> & { id: string }): OperatorFleetVehicle {
  return {
    operatorId: 'op_1',
    classId: null,
    pickupLocationId: null,
    name: `Vehicle ${over.id}`,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 300 A 12-34',
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
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
    ...over,
  }
}

function withProviders(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        {ui}
      </IntlProvider>
    </QueryClientProvider>,
  )
}

const ALPHA = makeVehicle({ id: 'alpha' })
const BETA = makeVehicle({ id: 'beta' })

function renderTable(
  over: { canWrite?: boolean; onEdit?: (v: OperatorFleetVehicle) => void } = {},
) {
  const onEdit = over.onEdit ?? vi.fn()
  withProviders(
    <FleetTable
      vehicles={[ALPHA, BETA]}
      selectedIds={[]}
      allSelected={false}
      someSelected={false}
      onToggleAll={vi.fn()}
      onToggleOne={vi.fn()}
      onEdit={onEdit}
      canWrite={over.canWrite ?? true}
      todayIso="2026-06-30"
      locale="en"
    />,
  )
  return { onEdit }
}

function renderGrid(over: { canWrite?: boolean; onEdit?: (v: OperatorFleetVehicle) => void } = {}) {
  const onEdit = over.onEdit ?? vi.fn()
  withProviders(
    <FleetGrid
      vehicles={[ALPHA, BETA]}
      classOptions={[]}
      selectedIds={[]}
      allSelected={false}
      someSelected={false}
      onToggleAll={vi.fn()}
      onToggleGroup={vi.fn()}
      onToggleSelect={vi.fn()}
      onEdit={onEdit}
      canWrite={over.canWrite ?? true}
      todayIso="2026-06-30"
      locale="en"
    />,
  )
  return { onEdit }
}

describe('FleetTable visible Edit action (#1275)', () => {
  it('renders one visible Edit control per row, keyed by accessible name', () => {
    renderTable()
    const editButtons = screen.getAllByRole('button', { name: EDIT_LABEL })
    expect(editButtons).toHaveLength(2)
  })

  it("calls onEdit with that row's vehicle when the Edit control is clicked", () => {
    const { onEdit } = renderTable()
    const betaRow = screen.getByText(BETA.name).closest('tr') as HTMLElement
    fireEvent.click(within(betaRow).getByRole('button', { name: EDIT_LABEL }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(BETA)
  })

  it('hides the Edit control for read-only (canWrite=false) viewers', () => {
    renderTable({ canWrite: false })
    expect(screen.queryByRole('button', { name: EDIT_LABEL })).toBeNull()
  })
})

describe('FleetVehicleCard visible Edit action (#1275)', () => {
  it('renders one visible Edit control per card, keyed by accessible name', () => {
    renderGrid()
    const editButtons = screen.getAllByRole('button', { name: EDIT_LABEL })
    expect(editButtons).toHaveLength(2)
  })

  it("calls onEdit with that card's vehicle when the Edit control is clicked", () => {
    const { onEdit } = renderGrid()
    const betaCard = screen.getByText(BETA.name).closest('div.rounded-xl') as HTMLElement
    fireEvent.click(within(betaCard).getByRole('button', { name: EDIT_LABEL }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(BETA)
  })

  it('hides the Edit control for read-only (canWrite=false) viewers', () => {
    renderGrid({ canWrite: false })
    expect(screen.queryByRole('button', { name: EDIT_LABEL })).toBeNull()
  })
})
