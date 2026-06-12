import { OperatorFeesView } from '@/vite/operator-fees/OperatorFeesView'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

const classId = '11111111-1111-4111-8111-111111111111'
const classes = [{ id: classId, name: 'Compact' }]

const operatorWideFee = {
  id: 'fee_wide',
  operatorId: 'op_1',
  vehicleClassId: null,
  feeType: 'CLEANING_FLAT' as const,
  unit: 'FLAT' as const,
  amountJpy: 3000,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}
const classScopedFee = {
  ...operatorWideFee,
  id: 'fee_class',
  vehicleClassId: classId,
  feeType: 'OVERTIME_HOURLY' as const,
  unit: 'PER_HOUR' as const,
}

afterEach(() => cleanup())

describe('OperatorFeesView', () => {
  it('renders a row per fee with its type and status', () => {
    render(<OperatorFeesView fees={[operatorWideFee]} classes={classes} />, { wrapper })
    expect(screen.getByRole('heading', { name: 'type.CLEANING_FLAT' })).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
  })

  it('resolves a scoped fee to its class name and an unscoped fee to operator-wide', () => {
    render(<OperatorFeesView fees={[operatorWideFee, classScopedFee]} classes={classes} />, {
      wrapper,
    })
    // class-scoped fee shows the resolved class name from the scoped class list
    expect(screen.getByText('Compact')).toBeInTheDocument()
    // operator-wide fee (vehicleClassId null) shows the operator-wide label
    expect(screen.getByText('form.operatorWide')).toBeInTheDocument()
  })

  it('shows the empty state when there are no fees', () => {
    render(<OperatorFeesView fees={[]} classes={classes} />, { wrapper })
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('sorts fees by type ascending', () => {
    render(<OperatorFeesView fees={[classScopedFee, operatorWideFee]} classes={classes} />, {
      wrapper,
    })
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['type.CLEANING_FLAT', 'type.OVERTIME_HOURLY'])
  })

  it('opens the Add dialog (renders the fee form) when Add is clicked', async () => {
    const user = userEvent.setup()
    render(<OperatorFeesView fees={[]} classes={classes} />, { wrapper })

    expect(screen.queryByLabelText('form.feeType')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'addFee' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('form.feeType')).toBeInTheDocument()
  })

  it('disables the archive action for an already-archived fee', () => {
    const archived = { ...operatorWideFee, id: 'arch', status: 'ARCHIVED' as const }
    render(<OperatorFeesView fees={[archived]} classes={classes} />, { wrapper })
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeDisabled()
  })
})
