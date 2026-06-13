import { CancelBookingDialog } from '@/vite/operator-bookings/CancelBookingDialog'
import * as api from '@/vite/operator-bookings/api'
import { OPERATOR_BOOKINGS_KEY } from '@/vite/operator-bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const c = enMessages.bookings.operator.detail.cancelBooking

function renderDialog(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <CancelBookingDialog bookingId="bk-1" csrfToken="csrf-tok" />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('CancelBookingDialog', () => {
  it('does not cancel until the confirmation is opened and confirmed', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    renderDialog()

    // The trigger alone must not fire the destructive call.
    await user.click(screen.getByRole('button', { name: c.action }))
    expect(spy).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: c.confirm }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'csrf-tok'))
  })

  it('invalidates the operator-bookings prefix and closes on success', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderDialog(queryClient)

    await user.click(screen.getByRole('button', { name: c.action }))
    await user.click(screen.getByRole('button', { name: c.confirm }))

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: OPERATOR_BOOKINGS_KEY }),
    )
    // The dialog closes on success (the confirm button only renders while open).
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: c.confirm })).not.toBeInTheDocument(),
    )
  })

  it('surfaces an error and stays open when the cancellation fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'cancelBooking').mockRejectedValue(new Error('409'))
    renderDialog()

    await user.click(screen.getByRole('button', { name: c.action }))
    await user.click(screen.getByRole('button', { name: c.confirm }))

    expect(await screen.findByText(c.error)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: c.confirm })).toBeInTheDocument()
  })
})
