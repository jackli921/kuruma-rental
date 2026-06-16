import { ManualBookingDialog } from '@/vite/operator-bookings/ManualBookingDialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const c = enMessages.bookings.operator.newBooking

function renderDialog(open = true) {
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={enMessages}>
        <ManualBookingDialog open={open} onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

describe('ManualBookingDialog', () => {
  it('renders the dialog title and description when open', () => {
    renderDialog(true)
    expect(screen.getByRole('heading', { name: c.dialogTitle })).toBeInTheDocument()
    expect(screen.getByText(c.dialogDescription)).toBeInTheDocument()
  })

  it('renders no dialog content when closed', () => {
    renderDialog(false)
    expect(screen.queryByRole('heading', { name: c.dialogTitle })).not.toBeInTheDocument()
  })

  it('requests close (onOpenChange false) when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog(true)
    await user.click(screen.getByRole('button', { name: c.cancel }))
    // base-ui calls onOpenChange(open, event, reason) — assert the first arg only.
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  })
})
