import { OperatorAddOnsView } from '@/vite/operator-add-ons/OperatorAddOnsView'
import type { OperatorScope } from '@/vite/operator-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// These cover the view's rendering mechanics (rows, empty, sort, dialog, archive
// gating) AND the operator-context scope behavior (all-mode labels, read-only
// gating, scoped-write affordances) — this is the single home for the add-ons
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

// The Add dialog reads the UI locale and fetches the template picker on open, so
// the mock must supply useLocale and fetch must return a (valid, empty) picker.
vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })),
)

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const addOn = {
  id: 'addon_1',
  operatorId: 'op_1',
  templateId: 'tmpl_1',
  resolvedName: 'Child seat',
  resolvedDescription: 'For toddlers',
  descriptionOverride: null,
  priceJpy: 1500,
  status: 'ACTIVE' as const,
}

afterEach(() => cleanup())

describe('OperatorAddOnsView', () => {
  it('renders a row per add-on with its name and status badge', () => {
    render(<OperatorAddOnsView addOns={[addOn]} scope={writeScope} />, { wrapper })
    expect(screen.getByRole('heading', { name: 'Child seat' })).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'editOption' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no add-ons', () => {
    render(<OperatorAddOnsView addOns={[]} scope={writeScope} />, { wrapper })
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('sorts add-ons by name ascending', () => {
    const b = { ...addOn, id: 'b', resolvedName: 'Bike rack' }
    const z = { ...addOn, id: 'z', resolvedName: 'Wi-Fi router' }
    render(<OperatorAddOnsView addOns={[z, b]} scope={writeScope} />, { wrapper })
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Bike rack', 'Wi-Fi router'])
  })

  it('opens the Add dialog (renders the add-on form) when Add is clicked', async () => {
    const user = userEvent.setup()
    render(<OperatorAddOnsView addOns={[]} scope={writeScope} />, { wrapper })

    expect(screen.queryByLabelText('form.template')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'addOption' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('form.template')).toBeInTheDocument()
  })

  it('disables the archive action for an already-archived add-on', () => {
    const archived = {
      ...addOn,
      id: 'arch',
      resolvedName: 'Old extra',
      status: 'ARCHIVED' as const,
    }
    render(<OperatorAddOnsView addOns={[archived]} scope={writeScope} />, { wrapper })
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeDisabled()
  })

  it('all-mode: shows the operator label and hides the Add button (read-only)', () => {
    render(<OperatorAddOnsView addOns={[addOn]} scope={allModeScope} />, { wrapper })
    expect(screen.getByText('Sakura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'addOption' })).not.toBeInTheDocument()
  })

  it('scoped-write mode: shows the Add button and no operator label', () => {
    // showOperator:false suppresses the badge even though op_1 -> Sakura resolves.
    const scope = { ...scopedWriteScope, operatorNameById: new Map([['op_1', 'Sakura']]) }
    render(<OperatorAddOnsView addOns={[addOn]} scope={scope} />, { wrapper })
    expect(screen.getByRole('button', { name: 'addOption' })).toBeInTheDocument()
    expect(screen.queryByText('Sakura')).not.toBeInTheDocument()
  })

  it('read-only mode hides the per-row Edit/Archive affordances', () => {
    render(<OperatorAddOnsView addOns={[addOn]} scope={readOnlyScope} />, { wrapper })
    expect(screen.queryByRole('button', { name: 'editOption' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'archiveAction' })).not.toBeInTheDocument()
  })
})

// #1456 seam guard: the view threads `scope.pickedOperatorId` into the Edit/Archive
// dialogs so a picker admin's update/archive binds to the chosen tenant via
// ?operatorId=. Drop the prop on any of view -> dialog -> api and the write loses
// its binding (a silent 422 / wrong-tenant write in prod) -- these drive the real
// fetch to catch that. Mirrors the locations seam guard (#1456) and fees (#1442).
describe('OperatorAddOnsView picker threading (#1456)', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  afterEach(() => fetchSpy.mockReset())

  // Faithful schema-complete response (nameI18n: null): a response missing a
  // required field would float an unhandled rejection through unwrap and turn CI red.
  function stubWrite() {
    const data = { ...addOn, operatorId: 'op_9', nameI18n: null, status: 'ARCHIVED' as const }
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data }), { status: 200 }),
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
    render(<OperatorAddOnsView addOns={[addOn]} scope={scopedWriteScope} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'editOption' }))
    await user.click(await screen.findByRole('button', { name: 'form.save' }))

    await waitFor(() => expect(writeCall('PATCH')).toBeDefined())
    expect(String(writeCall('PATCH')?.[0])).toContain('operatorId=op_9')
  })

  it('binds the archive DELETE to the picked operator via ?operatorId=', async () => {
    stubWrite()
    const user = userEvent.setup()
    render(<OperatorAddOnsView addOns={[addOn]} scope={scopedWriteScope} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'archiveAction' }))
    await user.click(await screen.findByRole('button', { name: 'archiveConfirm' }))

    await waitFor(() => expect(writeCall('DELETE')).toBeDefined())
    expect(String(writeCall('DELETE')?.[0])).toContain('operatorId=op_9')
  })

  it('omits operatorId when no operator is picked (operator session auto-scopes)', async () => {
    stubWrite()
    const user = userEvent.setup()
    render(<OperatorAddOnsView addOns={[addOn]} scope={writeScope} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'archiveAction' }))
    await user.click(await screen.findByRole('button', { name: 'archiveConfirm' }))

    await waitFor(() => expect(writeCall('DELETE')).toBeDefined())
    expect(String(writeCall('DELETE')?.[0])).not.toContain('operatorId=')
  })
})
