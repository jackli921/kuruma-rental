import { formatJpy } from '@/lib/format'
import type { Customer } from '@kuruma/shared/types/customer'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { CustomersView } from './CustomersView'

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: 'usr_1',
  name: 'Aiko Tanaka',
  email: 'aiko@example.com',
  language: 'ja',
  country: 'JP',
  bookingCount: 3,
  lastBookingAt: '2026-06-01T09:00:00.000Z',
  totalSpent: 48000,
  ...over,
})

type ViewProps = Parameters<typeof CustomersView>[0]

function renderView(over: Partial<ViewProps> = {}) {
  const props: ViewProps = {
    customers: [customer()],
    search: '',
    onSearchChange: vi.fn(),
    sort: 'lastBookingAt',
    onSortChange: vi.fn(),
    onSelectCustomer: vi.fn(),
    selectedCustomer: null,
    isDetailOpen: false,
    isDetailLoading: false,
    onCloseDetail: vi.fn(),
    canPrev: false,
    canNext: false,
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    ...over,
  }
  render(
    <IntlProvider locale="en" messages={en}>
      <CustomersView {...props} />
    </IntlProvider>,
  )
  return props
}

describe('CustomersView', () => {
  it('shows the empty state and no data rows when no customers match', () => {
    renderView({ customers: [] })
    expect(screen.queryByText(en.admin.customers.empty)).not.toBeNull()
    // header row only — no <td> body cells
    expect(screen.queryByRole('cell')).toBeNull()
  })

  it('renders a row per customer with the mapped name, bookings and formatted spend', () => {
    renderView({
      customers: [
        customer(),
        customer({
          id: 'usr_2',
          name: 'Ben Ito',
          email: 'ben@example.com',
          bookingCount: 7,
          totalSpent: 120000,
        }),
      ],
    })

    // 1 header + 2 data rows
    expect(screen.getAllByRole('row')).toHaveLength(3)

    const aikoRow = screen.getByRole('button', { name: 'Aiko Tanaka' }).closest('tr')!
    expect(within(aikoRow).queryByText('aiko@example.com')).not.toBeNull()
    expect(within(aikoRow).queryByText('3')).not.toBeNull()
    expect(within(aikoRow).queryByText(formatJpy(48000))).not.toBeNull()

    const benRow = screen.getByRole('button', { name: 'Ben Ito' }).closest('tr')!
    expect(within(benRow).queryByText('7')).not.toBeNull()
    expect(within(benRow).queryByText(formatJpy(120000))).not.toBeNull()
  })

  it('falls back to placeholder copy for a nameless / email-less walk-in', () => {
    renderView({ customers: [customer({ name: null, email: null })] })
    expect(screen.queryByRole('button', { name: en.admin.customers.unnamed })).not.toBeNull()
    expect(screen.queryByText(en.admin.customers.noEmail)).not.toBeNull()
  })

  it('selects a customer by its id when the name button is clicked', () => {
    const { onSelectCustomer } = renderView({
      customers: [customer({ id: 'usr_9', name: 'Cho Lin' })],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cho Lin' }))
    expect(onSelectCustomer).toHaveBeenCalledWith('usr_9')
  })

  it('forwards the typed query to onSearchChange', () => {
    const { onSearchChange } = renderView()
    fireEvent.change(screen.getByLabelText(en.admin.customers.searchLabel), {
      target: { value: 'tan' },
    })
    expect(onSearchChange).toHaveBeenCalledWith('tan')
  })

  it('forwards the chosen sort key to onSortChange', () => {
    const { onSortChange } = renderView()
    fireEvent.change(screen.getByLabelText(en.admin.customers.sortLabel), {
      target: { value: 'bookingCount' },
    })
    expect(onSortChange).toHaveBeenCalledWith('bookingCount')
  })

  it('disables Next on the last page and never advances the cursor', () => {
    const { onNextPage } = renderView({ canNext: false })
    const next = screen.getByRole('button', { name: en.admin.customers.next }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    fireEvent.click(next)
    expect(onNextPage).not.toHaveBeenCalled()
  })

  it('advances the cursor via onNextPage when a next page exists', () => {
    const { onNextPage } = renderView({ canNext: true })
    const next = screen.getByRole('button', { name: en.admin.customers.next }) as HTMLButtonElement
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    expect(onNextPage).toHaveBeenCalledTimes(1)
  })

  it('disables Previous on the first page', () => {
    renderView({ canPrev: false })
    const prev = screen.getByRole('button', { name: en.admin.customers.prev }) as HTMLButtonElement
    expect(prev.disabled).toBe(true)
  })

  it('pages back via onPrevPage from a later page', () => {
    const { onPrevPage } = renderView({ canPrev: true })
    fireEvent.click(screen.getByRole('button', { name: en.admin.customers.prev }))
    expect(onPrevPage).toHaveBeenCalledTimes(1)
  })
})
