import type { OperatorScope } from '@/vite/operator-context'
import { OperatorInsuranceView } from '@/vite/operator-insurance/OperatorInsuranceView'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// These cover the view's rendering mechanics (rows, empty, sort, dialog, archive
// gating) AND the operator-context scope behavior (all-mode labels, read-only
// gating, scoped-write affordances) — this is the single home for the insurance
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

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const option = {
  id: 'ins_1',
  operatorId: 'op_1',
  name: 'Full cover',
  // 3a: the row renders from the `name` mirror; a legacy null bundle is valid.
  nameI18n: null,
  description: 'Everything covered',
  dailyPriceJpy: 2000,
  deductibleJpy: null,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

afterEach(() => cleanup())

describe('OperatorInsuranceView', () => {
  it('renders a row per option with its name and status badge', () => {
    render(<OperatorInsuranceView options={[option]} scope={writeScope} />, { wrapper })
    expect(screen.getByRole('heading', { name: 'Full cover' })).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'editOption' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no options', () => {
    render(<OperatorInsuranceView options={[]} scope={writeScope} />, { wrapper })
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('sorts options by name ascending', () => {
    const b = { ...option, id: 'b', name: 'Basic' }
    const z = { ...option, id: 'z', name: 'Zen' }
    render(<OperatorInsuranceView options={[z, b]} scope={writeScope} />, { wrapper })
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Basic', 'Zen'])
  })

  it('opens the Add dialog (renders the insurance form) when Add is clicked', async () => {
    const user = userEvent.setup()
    render(<OperatorInsuranceView options={[]} scope={writeScope} />, { wrapper })

    expect(screen.queryByLabelText('form.nameEn')).not.toBeInTheDocument()
    // The page Add button and the dialog title share the 'addOption' key; click
    // the button (the only one before the dialog opens).
    await user.click(screen.getByRole('button', { name: 'addOption' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('form.nameEn')).toBeInTheDocument()
  })

  it('disables the archive action for an already-archived option', () => {
    const archived = { ...option, id: 'arch', name: 'Old plan', status: 'ARCHIVED' as const }
    render(<OperatorInsuranceView options={[archived]} scope={writeScope} />, { wrapper })
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeDisabled()
  })

  it('all-mode: shows the operator label and hides the Add button (read-only)', () => {
    render(<OperatorInsuranceView options={[option]} scope={allModeScope} />, { wrapper })
    expect(screen.getByText('Sakura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'addOption' })).not.toBeInTheDocument()
  })

  it('scoped-write mode: shows the Add button and no operator label', () => {
    // showOperator:false suppresses the badge even though op_1 -> Sakura resolves.
    const scope = { ...scopedWriteScope, operatorNameById: new Map([['op_1', 'Sakura']]) }
    render(<OperatorInsuranceView options={[option]} scope={scope} />, { wrapper })
    expect(screen.getByRole('button', { name: 'addOption' })).toBeInTheDocument()
    expect(screen.queryByText('Sakura')).not.toBeInTheDocument()
  })

  it('read-only mode hides the per-row Edit/Archive affordances', () => {
    render(<OperatorInsuranceView options={[option]} scope={readOnlyScope} />, { wrapper })
    expect(screen.queryByRole('button', { name: 'editOption' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'archiveAction' })).not.toBeInTheDocument()
  })
})
