import { ApiError } from '@/lib/api-error'
import { DeleteClassDialog } from '@/vite/operator-classes/DeleteClassDialog'
import type { OperatorClass } from '@/vite/operator-classes/api'
import { archiveOperatorClass } from '@/vite/operator-classes/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@/vite/operator-classes/api', () => ({ archiveOperatorClass: vi.fn() }))

function makeClass(over: Partial<OperatorClass> = {}): OperatorClass {
  return {
    id: 'c-1',
    operatorId: 'op-1',
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function renderDialog(vehicleClass: OperatorClass | null) {
  const onOpenChange = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <DeleteClassDialog vehicleClass={vehicleClass} onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidate }
}

afterEach(() => vi.clearAllMocks())

describe('DeleteClassDialog', () => {
  it('archives the class id, invalidates the list, and closes on confirm', async () => {
    vi.mocked(archiveOperatorClass).mockResolvedValue(makeClass({ status: 'ARCHIVED' }))
    const { onOpenChange, invalidate } = renderDialog(makeClass({ id: 'c-42' }))

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(archiveOperatorClass).toHaveBeenCalledTimes(1))
    expect(vi.mocked(archiveOperatorClass).mock.calls[0]?.[0]).toBe('c-42')
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-classes'] })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('surfaces the server 409 active-bookings block and keeps the dialog open', async () => {
    vi.mocked(archiveOperatorClass).mockRejectedValue(
      new ApiError('Cannot archive a class with active bookings', 409),
    )
    const { onOpenChange } = renderDialog(makeClass())

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByText('Cannot archive a class with active bookings'),
    ).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('guards a double-click so archive fires only once', async () => {
    // A pending (never-resolving) archive keeps the mutation in-flight.
    vi.mocked(archiveOperatorClass).mockReturnValue(new Promise<never>(() => {}))
    renderDialog(makeClass({ id: 'c-1' }))

    const confirm = screen.getByRole('button', { name: 'Delete' })
    // Two clicks in the same frame: the synchronous inFlightRef stops the second
    // from scheduling a mutation. React Query invokes the mutationFn on a
    // microtask, so await to let any (single) call land — it never reaches 2.
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await waitFor(() => expect(archiveOperatorClass).toHaveBeenCalledTimes(1))
  })
})
