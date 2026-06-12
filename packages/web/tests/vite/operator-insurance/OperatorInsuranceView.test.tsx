import { OperatorInsuranceView } from '@/vite/operator-insurance/OperatorInsuranceView'
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

const option = {
  id: 'ins_1',
  operatorId: 'op_1',
  name: 'Full cover',
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
    render(<OperatorInsuranceView options={[option]} />, { wrapper })
    expect(screen.getByRole('heading', { name: 'Full cover' })).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'editOption' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no options', () => {
    render(<OperatorInsuranceView options={[]} />, { wrapper })
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('sorts options by name ascending', () => {
    const b = { ...option, id: 'b', name: 'Basic' }
    const z = { ...option, id: 'z', name: 'Zen' }
    render(<OperatorInsuranceView options={[z, b]} />, { wrapper })
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Basic', 'Zen'])
  })

  it('opens the Add dialog (renders the insurance form) when Add is clicked', async () => {
    const user = userEvent.setup()
    render(<OperatorInsuranceView options={[]} />, { wrapper })

    expect(screen.queryByLabelText('form.name')).not.toBeInTheDocument()
    // The page Add button and the dialog title share the 'addOption' key; click
    // the button (the only one before the dialog opens).
    await user.click(screen.getByRole('button', { name: 'addOption' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('form.name')).toBeInTheDocument()
  })

  it('disables the archive action for an already-archived option', () => {
    const archived = { ...option, id: 'arch', name: 'Old plan', status: 'ARCHIVED' as const }
    render(<OperatorInsuranceView options={[archived]} />, { wrapper })
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeDisabled()
  })
})
