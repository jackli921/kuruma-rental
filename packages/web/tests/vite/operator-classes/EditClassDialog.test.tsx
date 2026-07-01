import { ApiError } from '@/lib/api-error'
import { EditClassDialog } from '@/vite/operator-classes/EditClassDialog'
import type { OperatorClass } from '@/vite/operator-classes/api'
import { updateOperatorClass } from '@/vite/operator-classes/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The dialog reads the CSRF token from the session and forwards it to the update
// call so the csrf() middleware admits the cookie write (#1304).
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

vi.mock('@/vite/operator-classes/api', () => ({ updateOperatorClass: vi.fn() }))

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
        <EditClassDialog vehicleClass={vehicleClass} onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidate }
}

afterEach(() => vi.clearAllMocks())

describe('EditClassDialog', () => {
  it('prefills the form from the selected class', () => {
    renderDialog(makeClass({ name: 'Compact', slug: 'compact' }))
    expect(screen.getByLabelText('Class name')).toHaveValue('Compact')
    expect(screen.getByLabelText('Slug')).toHaveValue('compact')
  })

  it('prefills the luggage size from the selected class', () => {
    renderDialog(makeClass({ luggageSize: 'LARGE' }))
    expect(screen.getByLabelText('Luggage size')).toHaveValue('LARGE')
  })

  it('PATCHes the class id with the edited fields, invalidates, and closes', async () => {
    vi.mocked(updateOperatorClass).mockResolvedValue(makeClass({ name: 'Compact Plus' }))
    const { onOpenChange, invalidate } = renderDialog(makeClass({ id: 'c-42' }))

    const user = userEvent.setup()
    const name = screen.getByLabelText('Class name')
    await user.clear(name)
    await user.type(name, 'Compact Plus')
    await user.click(screen.getByRole('button', { name: 'Save class' }))

    await waitFor(() => expect(updateOperatorClass).toHaveBeenCalledTimes(1))
    // EditClassDialog calls updateOperatorClass(id, patch, csrfToken) directly.
    expect(updateOperatorClass).toHaveBeenCalledWith(
      'c-42',
      expect.objectContaining({ name: 'Compact Plus' }),
      'test-csrf',
    )
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-classes'] })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('surfaces a server error and keeps the dialog open', async () => {
    vi.mocked(updateOperatorClass).mockRejectedValue(new ApiError('Slug already in use', 409))
    const { onOpenChange } = renderDialog(makeClass())

    await userEvent.click(screen.getByRole('button', { name: 'Save class' }))

    expect(await screen.findByText('Slug already in use')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
