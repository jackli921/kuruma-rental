import { CancelBookingDialog } from '@/vite/operator-bookings/CancelBookingDialog'
import * as api from '@/vite/operator-bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const c = enMessages.bookings.operator.detail.cancelBooking

function renderDialog(queryClient = new QueryClient(), pickedOperatorId?: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <CancelBookingDialog
          bookingId="bk-1"
          csrfToken="csrf-tok"
          pickedOperatorId={pickedOperatorId}
        />
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
    // #1361: a tenant operator carries no picked operator, so the 4th arg is undefined.
    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'csrf-tok', undefined))
  })

  // #1361: a picker admin's cancel must carry its chosen operator (?operatorId=) or the
  // #1260 write guard 422s. tsc can't catch a dropped optional arg, so pin the thread.
  it('threads the picked operator into the cancel write for a picker admin', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    renderDialog(new QueryClient(), 'op_7')

    await user.click(screen.getByRole('button', { name: c.action }))
    await user.click(screen.getByRole('button', { name: c.confirm }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'csrf-tok', 'op_7'))
  })

  it('invalidates the booking + overview caches and closes on success', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderDialog(queryClient)

    await user.click(screen.getByRole('button', { name: c.action }))
    await user.click(screen.getByRole('button', { name: c.confirm }))

    // invalidateBookingCaches refreshes the operator-bookings prefix (detail +
    // timeline reflect CANCELLED) and the dashboard overview (#1099 Theme 4).
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-bookings'] }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-overview'] })
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
