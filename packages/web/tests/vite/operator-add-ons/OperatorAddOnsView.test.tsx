import { OperatorAddOnsView } from '@/vite/operator-add-ons/OperatorAddOnsView'
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

const addOn = {
  id: 'addon_1',
  operatorId: 'op_1',
  name: 'Child seat',
  description: 'For toddlers',
  priceJpy: 1500,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

afterEach(() => cleanup())

describe('OperatorAddOnsView', () => {
  it('renders a row per add-on with its name and status badge', () => {
    render(<OperatorAddOnsView addOns={[addOn]} />, { wrapper })
    expect(screen.getByRole('heading', { name: 'Child seat' })).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'editOption' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no add-ons', () => {
    render(<OperatorAddOnsView addOns={[]} />, { wrapper })
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('sorts add-ons by name ascending', () => {
    const b = { ...addOn, id: 'b', name: 'Bike rack' }
    const z = { ...addOn, id: 'z', name: 'Wi-Fi router' }
    render(<OperatorAddOnsView addOns={[z, b]} />, { wrapper })
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Bike rack', 'Wi-Fi router'])
  })

  it('opens the Add dialog (renders the add-on form) when Add is clicked', async () => {
    const user = userEvent.setup()
    render(<OperatorAddOnsView addOns={[]} />, { wrapper })

    expect(screen.queryByLabelText('form.name')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'addOption' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('form.name')).toBeInTheDocument()
  })

  it('disables the archive action for an already-archived add-on', () => {
    const archived = { ...addOn, id: 'arch', name: 'Old extra', status: 'ARCHIVED' as const }
    render(<OperatorAddOnsView addOns={[archived]} />, { wrapper })
    expect(screen.getByRole('button', { name: 'archiveAction' })).toBeDisabled()
  })
})
