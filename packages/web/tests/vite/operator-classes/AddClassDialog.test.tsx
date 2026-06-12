import { ApiError } from '@/lib/api-error'
import { AddClassDialog } from '@/vite/operator-classes/AddClassDialog'
import { createOperatorClass } from '@/vite/operator-classes/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@/vite/operator-classes/api', () => ({ createOperatorClass: vi.fn() }))

function renderDialog() {
  const onOpenChange = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <AddClassDialog open onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidate }
}

async function fillAndSubmit() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Class name'), 'Compact')
  await user.type(screen.getByLabelText('Slug'), 'compact')
  await user.click(screen.getByRole('button', { name: 'Save class' }))
}

afterEach(() => vi.clearAllMocks())

describe('AddClassDialog', () => {
  it('creates the class, invalidates the list, and closes on success', async () => {
    vi.mocked(createOperatorClass).mockResolvedValue({ id: 'c1' } as never)
    const { onOpenChange, invalidate } = renderDialog()

    await fillAndSubmit()

    await waitFor(() => expect(createOperatorClass).toHaveBeenCalledTimes(1))
    // React Query passes a second mutation-context arg to mutationFn; assert on
    // the first (the payload). The real client ignores the extra arg.
    expect(vi.mocked(createOperatorClass).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ name: 'Compact', slug: 'compact', seats: 5 }),
    )
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-classes'] })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('surfaces a slug collision (409) and keeps the dialog open', async () => {
    vi.mocked(createOperatorClass).mockRejectedValue(new ApiError('Slug already in use', 409))
    const { onOpenChange } = renderDialog()

    await fillAndSubmit()

    expect(await screen.findByText('Slug already in use')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
