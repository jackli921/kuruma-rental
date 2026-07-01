import { ApiError } from '@/lib/api-error'
import { formatJpy } from '@/lib/format'
import { CancelBookingDialog } from '@/vite/bookings/CancelBookingDialog'
import * as api from '@/vite/bookings/api'
import { BOOKINGS_KEY } from '@/vite/bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const c = enMessages.bookings.cancel

// The dialog reads the clock at render, so anchor pickup times relative to NOW.
// 50h leaves a 2h margin to the 48h boundary -> stable LOW (30%) tier without
// faking timers (fake timers would deadlock userEvent's internal timers).
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
const START_LOW = hoursFromNow(50)
const PAST_PICKUP = hoursFromNow(-1)

interface Overrides {
  startAt?: string
  totalPrice?: number | null
  operatorName?: string | null
}

function renderDialog(overrides: Overrides = {}, queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <CancelBookingDialog
          bookingId="bk-1"
          csrfToken="csrf-tok"
          startAt={overrides.startAt ?? START_LOW}
          totalPrice={overrides.totalPrice === undefined ? 20000 : overrides.totalPrice}
          operatorName={
            overrides.operatorName === undefined ? 'Best Car Rental' : overrides.operatorName
          }
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('CancelBookingDialog (renter, #856)', () => {
  it('does not cancel until the dialog is opened and confirmed', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    renderDialog()

    // The trigger alone must not fire the destructive call.
    await user.click(screen.getByRole('button', { name: c.action }))
    expect(spy).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: c.confirm }))
    // #868 3b: no reason picked -> the third arg is null (bodyless cancel preserved).
    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'csrf-tok', null))
  })

  it('passes the selected reason and trimmed note to the cancel call (#868 3b)', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    renderDialog()

    await user.click(screen.getByRole('button', { name: c.action }))
    // The note field only appears once a reason category is chosen.
    await user.click(screen.getByRole('radio', { name: c.reason.options.FOUND_ALTERNATIVE }))
    await user.type(screen.getByLabelText(c.reason.noteLabel), '  cheaper nearby  ')
    await user.click(screen.getByRole('button', { name: c.confirm }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('bk-1', 'csrf-tok', {
        code: 'FOUND_ALTERNATIVE',
        note: 'cheaper nearby',
      }),
    )
  })

  it('previews the tiered fee and estimated refund for a cancellation before pickup', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    renderDialog() // LOW tier, 20,000 total -> 6,000 fee / 14,000 refund

    await user.click(screen.getByRole('button', { name: c.action }))

    expect(screen.getByText(`Cancellation fee: ${formatJpy(6000)} (30%)`)).toBeInTheDocument()
    expect(screen.getByText(`Estimated refund: ${formatJpy(14000)}`)).toBeInTheDocument()
  })

  it('shows the no-show full-fee notice instead of the tiered breakdown once pickup has passed', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    renderDialog({ startAt: PAST_PICKUP }) // full fee = 20,000

    await user.click(screen.getByRole('button', { name: c.action }))

    expect(
      screen.getByText(`The pickup time has passed. The full fee (${formatJpy(20000)}) applies.`),
    ).toBeInTheDocument()
    // No tiered refund line in the no-show case.
    expect(screen.queryByText(/Estimated refund/)).not.toBeInTheDocument()
  })

  it('frames the fee as settled with the operator at pickup, not charged online', async () => {
    const user = userEvent.setup()
    renderDialog({ operatorName: 'Best Car Rental' })

    await user.click(screen.getByRole('button', { name: c.action }))
    expect(
      screen.getByText(
        'The fee is settled with Best Car Rental at pickup. Nothing is charged online now.',
      ),
    ).toBeInTheDocument()
  })

  it('invalidates the bookings prefix and closes on success', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'cancelBooking').mockResolvedValue({} as never)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderDialog({}, queryClient)

    await user.click(screen.getByRole('button', { name: c.action }))
    await user.click(screen.getByRole('button', { name: c.confirm }))

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: BOOKINGS_KEY }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: c.confirm })).not.toBeInTheDocument(),
    )
  })

  it('treats a 409 (already cancelled) as benign: refreshes and closes without an error', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'cancelBooking').mockRejectedValue(
      new ApiError('Booking is not cancellable', 409),
    )
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderDialog({}, queryClient)

    await user.click(screen.getByRole('button', { name: c.action }))
    await user.click(screen.getByRole('button', { name: c.confirm }))

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: BOOKINGS_KEY }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: c.confirm })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText(c.error)).not.toBeInTheDocument()
  })

  it('surfaces an error and stays open when the cancellation fails for another reason', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'cancelBooking').mockRejectedValue(new ApiError('Server error', 500))
    renderDialog()

    await user.click(screen.getByRole('button', { name: c.action }))
    await user.click(screen.getByRole('button', { name: c.confirm }))

    expect(await screen.findByText(c.error)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: c.confirm })).toBeInTheDocument()
  })

  it('gives each cancel-reason radio a coarse-pointer touch row so it is tappable on a phone (#1301)', async () => {
    // Regression pin: the reason radios were a 16px input in a ~20px row. Each row's
    // <label> (the full-width tap target) must opt into the >=44px touch floor on
    // coarse pointers; the mobile Playwright lane proves the resulting geometry.
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: c.action }))
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(Object.keys(c.reason.options).length)
    for (const radio of radios) {
      expect(radio.closest('label')?.className).toMatch(/pointer-coarse:/)
    }
  })

  it('fires exactly one cancel request when confirm is double-clicked before a re-render', async () => {
    const user = userEvent.setup()
    // Never resolves: the mutation stays in-flight. Both clicks land inside one
    // act() flush, so isPending has not flipped yet — only the synchronous
    // inFlightRef guard can stop the second destructive POST. Drop the ref and
    // disabled={isPending} alone lets the second click through, failing this test.
    const spy = vi.spyOn(api, 'cancelBooking').mockReturnValue(new Promise<never>(() => {}))
    renderDialog()

    await user.click(screen.getByRole('button', { name: c.action }))
    const confirm = screen.getByRole('button', { name: c.confirm })
    act(() => {
      confirm.click()
      confirm.click()
    })

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  })
})
