import type { OperatorScope } from '@/vite/operator-context'
import { OperatorLocationsView } from '@/vite/operator-locations/OperatorLocationsView'
import type { OperatorLocation } from '@/vite/operator-locations/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const en = enMessages.business.locations

// The view owns the add/edit dialogs, which read the regions cascade on mount;
// stub the query so it resolves to an empty list without a network round-trip.
vi.mock('@/vite/regions/regions-api', () => ({
  regionsQueryOptions: () => ({ queryKey: ['regions'], queryFn: async () => [] }),
}))

// The dialogs read the session for the CSRF token on mount; stub it so they don't
// fire a real GET /auth/session round-trip in the view's render tests.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

// These cover the view's rendering mechanics (rows, empty, hours, pin/status
// badges, Add dialog) AND the operator-context scope behavior (all-mode labels,
// read-only gating, scoped-write affordances) — the single home for the locations
// view tests. A writable scope keeps the Add/Edit/Archive affordances visible.
const writeScope: OperatorScope = {
  pickedOperatorId: undefined,
  canWrite: true,
  showOperator: false,
  operatorNameById: new Map(),
}

// All-mode: a cross-operator reader with no picked operator. Read-only, with the
// per-row operator label turned on so the mixed-tenant list is legible.
const allModeScope: OperatorScope = {
  pickedOperatorId: undefined,
  canWrite: false,
  showOperator: true,
  operatorNameById: new Map([['op_1', 'Sakura']]),
}

// Scoped write: an operator session (or an admin who picked a tenant). Write
// affordances visible, no operator label.
const scopedWriteScope: OperatorScope = {
  pickedOperatorId: 'op_9',
  canWrite: true,
  showOperator: false,
  operatorNameById: new Map(),
}

// Read-only: a cross-operator reader (or any caller without write rights).
const readOnlyScope: OperatorScope = {
  pickedOperatorId: undefined,
  canWrite: false,
  showOperator: false,
  operatorNameById: new Map(),
}

function location(overrides: Partial<OperatorLocation> = {}): OperatorLocation {
  return {
    id: 'loc_1',
    operatorId: 'op_1',
    name: 'Namba Branch',
    address: '1-2-3 Namba, Chuo-ku, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
    coordinateSource: 'GEOCODED',
    regionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderView(locations: OperatorLocation[], scope: OperatorScope = writeScope) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={enMessages}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    )
  }
  return render(<OperatorLocationsView locations={locations} scope={scope} />, { wrapper })
}

afterEach(() => cleanup())

describe('OperatorLocationsView', () => {
  it('shows the empty state when there are no locations', () => {
    renderView([])
    expect(screen.getByText(en.empty)).toBeInTheDocument()
  })

  it('renders a location row with name, address, status and operating hours', () => {
    renderView([location()])
    expect(screen.getByText('Namba Branch')).toBeInTheDocument()
    expect(screen.getByText('1-2-3 Namba, Chuo-ku, Osaka')).toBeInTheDocument()
    expect(screen.getByText(en.status.ACTIVE)).toBeInTheDocument()
    // row.hours = "{open}–{close}" (en dash)
    expect(screen.getByText('09:00–20:00')).toBeInTheDocument()
  })

  it('shows "hours not set" when operatingHours is null', () => {
    renderView([location({ id: 'l2', operatingHours: null })])
    expect(screen.getByText(en.row.alwaysOpen)).toBeInTheDocument()
  })

  it('formats turnaround minutes as whole hours', () => {
    renderView([location({ id: 'l3', defaultTurnaroundMinutes: 2880 })])
    expect(screen.getByText('48h turnaround')).toBeInTheDocument()
  })

  it('renders the archived badge for an archived location', () => {
    renderView([location({ id: 'l4', status: 'ARCHIVED' })])
    expect(screen.getByText(en.status.ARCHIVED)).toBeInTheDocument()
  })

  it('renders one row per location', () => {
    renderView([location({ id: 'a', name: 'Loc A' }), location({ id: 'b', name: 'Loc B' })])
    expect(screen.getByText('Loc A')).toBeInTheDocument()
    expect(screen.getByText('Loc B')).toBeInTheDocument()
    expect(screen.getAllByTestId('location-row')).toHaveLength(2)
  })

  it('opens the Add dialog (renders the location form) when Add is clicked', async () => {
    const user = userEvent.setup()
    renderView([])

    expect(screen.queryByLabelText(en.form.name)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en.addLocation }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(en.form.name)).toBeInTheDocument()
  })

  it('disables the archive button for an archived location', () => {
    renderView([location({ id: 'l4', status: 'ARCHIVED' })])
    expect(screen.getByRole('button', { name: en.archiveAction })).toBeDisabled()
  })

  it('flags a throttle-skipped location with a "pin pending" badge (#601)', () => {
    renderView([location({ id: 'lp', coordinateSource: 'PENDING' })])
    expect(screen.getByText(en.pin.pending)).toBeInTheDocument()
  })

  it('flags a location with no geocode result as "no map pin" (#601)', () => {
    renderView([location({ id: 'ln', coordinateSource: null })])
    expect(screen.getByText(en.pin.missing)).toBeInTheDocument()
  })

  it.each(['GEOCODED', 'MANUAL'] as const)(
    'shows no pin-state badge for a %s location (#601)',
    (coordinateSource) => {
      renderView([location({ id: 'lg', coordinateSource })])
      expect(screen.queryByText(en.pin.pending)).not.toBeInTheDocument()
      expect(screen.queryByText(en.pin.missing)).not.toBeInTheDocument()
    },
  )

  it('all-mode: shows the operator label and hides the Add button (read-only)', () => {
    renderView([location()], allModeScope)
    expect(screen.getByText('Sakura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.addLocation })).not.toBeInTheDocument()
  })

  it('scoped-write mode: shows the Add button and no operator label', () => {
    // showOperator:false suppresses the badge even though op_1 -> Sakura resolves.
    renderView([location()], {
      ...scopedWriteScope,
      operatorNameById: new Map([['op_1', 'Sakura']]),
    })
    expect(screen.getByRole('button', { name: en.addLocation })).toBeInTheDocument()
    expect(screen.queryByText('Sakura')).not.toBeInTheDocument()
  })

  it('read-only mode hides the per-row Edit/Archive affordances', () => {
    renderView([location()], readOnlyScope)
    expect(screen.getByTestId('location-row')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.editLocation })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.archiveAction })).not.toBeInTheDocument()
  })
})

// #1456 seam guard: the view threads `scope.pickedOperatorId` into the Edit/Archive
// dialogs so a picker admin's update/archive binds to the chosen tenant via
// ?operatorId=. Drop the prop on any of view -> dialog -> api and the write loses
// its binding (a silent 422 / wrong-tenant write in prod) -- these drive the real
// fetch to catch that. Mirrors the fees seam guard (#1442).
describe('OperatorLocationsView picker threading (#1456)', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  afterEach(() => fetchSpy.mockReset())

  function stubWrite() {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: location({ status: 'ARCHIVED' }) }), {
        status: 200,
      }),
    )
  }

  function writeCall(method: string) {
    return fetchSpy.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === method,
    )
  }

  it('binds the edit PATCH to the picked operator via ?operatorId=', async () => {
    stubWrite()
    const user = userEvent.setup()
    renderView([location()], scopedWriteScope)

    await user.click(screen.getByRole('button', { name: en.editLocation }))
    await user.click(await screen.findByRole('button', { name: en.form.save }))

    await waitFor(() => expect(writeCall('PATCH')).toBeDefined())
    expect(String(writeCall('PATCH')?.[0])).toContain('operatorId=op_9')
  })

  it('binds the archive DELETE to the picked operator via ?operatorId=', async () => {
    stubWrite()
    const user = userEvent.setup()
    renderView([location()], scopedWriteScope)

    await user.click(screen.getByRole('button', { name: en.archiveAction }))
    await user.click(await screen.findByRole('button', { name: en.archiveConfirm }))

    await waitFor(() => expect(writeCall('DELETE')).toBeDefined())
    expect(String(writeCall('DELETE')?.[0])).toContain('operatorId=op_9')
  })

  it('omits operatorId when no operator is picked (operator session auto-scopes)', async () => {
    stubWrite()
    const user = userEvent.setup()
    renderView([location()], writeScope)

    await user.click(screen.getByRole('button', { name: en.archiveAction }))
    await user.click(await screen.findByRole('button', { name: en.archiveConfirm }))

    await waitFor(() => expect(writeCall('DELETE')).toBeDefined())
    expect(String(writeCall('DELETE')?.[0])).not.toContain('operatorId=')
  })
})
