import { ManualBookingDialog } from '@/vite/operator-bookings/ManualBookingDialog'
import { createManualBooking } from '@/vite/operator-bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// Only the network write is faked; OPERATOR_BOOKINGS_KEY + types stay real so the
// success path invalidates the genuine query key the calendar reads.
vi.mock('@/vite/operator-bookings/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/vite/operator-bookings/api')>()),
  createManualBooking: vi.fn(),
}))

const c = enMessages.bookings.operator.newBooking
const vehicles = [
  { id: 'veh-1', name: 'Toyota Aqua' },
  { id: 'veh-2', name: 'Honda Fit' },
]
const locations = [
  { id: 'loc-1', name: 'Namba Store' },
  { id: 'loc-2', name: 'Kansai Airport' },
]

// The existing-customer picker reads /customers/search; stub the envelope so the
// real searchCustomers + queryOptions run end to end with only the network faked.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
const tanaka = {
  id: 'r-9',
  name: 'Tanaka Hiro',
  email: 'tanaka@example.com',
  phone: '+81-90-1234-5678',
}

// 2026-07-01T01:00Z / 2026-07-03T01:00Z are 10:00 JST — the form shows + round-trips
// wall-clock Tokyo, so a prefill from these instants submits the same ISO back.
const initialRange = {
  start: new Date('2026-07-01T01:00:00.000Z'),
  end: new Date('2026-07-03T01:00:00.000Z'),
}

function renderDialog(props: Record<string, unknown> = {}) {
  const onOpenChange = vi.fn()
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <ManualBookingDialog
          open
          onOpenChange={onOpenChange}
          vehicles={vehicles}
          locations={locations}
          csrfToken="csrf-tok"
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, queryClient }
}

beforeEach(() => {
  vi.mocked(createManualBooking)
    .mockReset()
    .mockResolvedValue({ id: 'bk-new' } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ManualBookingDialog', () => {
  it('renders the dialog title and description when open', () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: c.dialogTitle })).toBeInTheDocument()
    expect(screen.getByText(c.dialogDescription)).toBeInTheDocument()
  })

  it('renders no dialog content when closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByRole('heading', { name: c.dialogTitle })).not.toBeInTheDocument()
  })

  it('requests close (onOpenChange false) when the cancel button is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    const { onOpenChange } = renderDialog()
    await user.click(screen.getByRole('button', { name: c.cancel }))
    // base-ui calls onOpenChange(open, event, reason) — assert the first arg only.
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  })

  it('renders the walk-in form controls when open', () => {
    renderDialog()
    expect(screen.getByLabelText(c.vehicleLabel)).toBeInTheDocument()
    expect(screen.getByLabelText(c.locationLabel)).toBeInTheDocument()
    expect(screen.getByLabelText(c.startLabel)).toBeInTheDocument()
    expect(screen.getByLabelText(c.endLabel)).toBeInTheDocument()
    expect(screen.getByLabelText(c.nameLabel)).toBeInTheDocument()
    expect(screen.getByLabelText(c.phoneLabel)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: c.submit })).toBeInTheDocument()
  })

  it('prefills pickup and return from the clicked slot range (wall-clock JST)', () => {
    renderDialog({ initialRange })
    expect(screen.getByLabelText(c.startLabel)).toHaveValue('2026-07-01T10:00')
    expect(screen.getByLabelText(c.endLabel)).toHaveValue('2026-07-03T10:00')
  })

  it('submits the walk-in booking: vehicle/location defaults, ISO times, name+phone, CSRF', async () => {
    const user = userEvent.setup({ delay: null })
    renderDialog({ initialRange })

    await user.type(screen.getByLabelText(c.nameLabel), 'Taro Yamada')
    await user.type(screen.getByLabelText(c.phoneLabel), '09012345678')
    await user.click(screen.getByRole('button', { name: c.submit }))

    expect(createManualBooking).toHaveBeenCalledTimes(1)
    const [input, token] = vi.mocked(createManualBooking).mock.calls[0]!
    expect(token).toBe('csrf-tok')
    // A fresh idempotency key is minted per dialog-open so a double-submit replays
    // server-side instead of double-booking; it is a uuid, not a fixed value.
    expect(input).toEqual({
      requestedVehicleId: 'veh-1',
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-1',
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-03T01:00:00.000Z',
      customer: { kind: 'walk-in', name: 'Taro Yamada', phone: '09012345678' },
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ),
    })
  })

  it('invalidates the booking + overview caches and closes on success', async () => {
    const user = userEvent.setup({ delay: null })
    const { onOpenChange, queryClient } = renderDialog({ initialRange })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.type(screen.getByLabelText(c.nameLabel), 'Taro Yamada')
    await user.type(screen.getByLabelText(c.phoneLabel), '09012345678')
    await user.click(screen.getByRole('button', { name: c.submit }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    // invalidateBookingCaches: the new booking appears on the calendar (prefix
    // cascade) and the dashboard overview counts refresh (#1099 Theme 4).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-bookings'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-overview'] })
  })

  it('disables submit until vehicle, location, times, name and phone are all present', async () => {
    const user = userEvent.setup({ delay: null })
    renderDialog() // no initialRange -> pickup/return start empty

    const submit = screen.getByRole('button', { name: c.submit })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(c.startLabel), { target: { value: '2026-07-01T10:00' } })
    fireEvent.change(screen.getByLabelText(c.endLabel), { target: { value: '2026-07-03T10:00' } })
    await user.type(screen.getByLabelText(c.nameLabel), 'Taro Yamada')
    expect(submit).toBeDisabled() // phone still missing

    await user.type(screen.getByLabelText(c.phoneLabel), '09012345678')
    expect(submit).toBeEnabled()
  })

  it('shows an error message when the create fails', async () => {
    vi.mocked(createManualBooking).mockRejectedValue(new Error('boom'))
    const user = userEvent.setup({ delay: null })
    renderDialog({ initialRange })

    await user.type(screen.getByLabelText(c.nameLabel), 'Taro Yamada')
    await user.type(screen.getByLabelText(c.phoneLabel), '09012345678')
    await user.click(screen.getByRole('button', { name: c.submit }))

    expect(await screen.findByText(c.error)).toBeInTheDocument()
  })

  it('swaps the walk-in name/phone inputs for the customer search in existing mode', async () => {
    const user = userEvent.setup({ delay: null })
    renderDialog()

    expect(screen.getByLabelText(c.nameLabel)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: c.customerExistingTab }))

    expect(screen.queryByLabelText(c.nameLabel)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(c.phoneLabel)).not.toBeInTheDocument()
    expect(screen.getByLabelText(c.customerSearchLabel)).toBeInTheDocument()
  })

  it('keeps submit disabled in existing mode until a customer is selected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [tanaka] })),
    )
    const user = userEvent.setup({ delay: null })
    renderDialog({ initialRange })

    await user.click(screen.getByRole('button', { name: c.customerExistingTab }))
    const submit = screen.getByRole('button', { name: c.submit })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText(c.customerSearchLabel), 'tan')
    await user.click(await screen.findByText('Tanaka Hiro'))

    expect(submit).toBeEnabled()
  })

  it('submits an existing-customer booking carrying renterId (not walkInCustomer)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [tanaka] })),
    )
    const user = userEvent.setup({ delay: null })
    renderDialog({ initialRange })

    await user.click(screen.getByRole('button', { name: c.customerExistingTab }))
    await user.type(screen.getByLabelText(c.customerSearchLabel), 'tan')
    await user.click(await screen.findByText('Tanaka Hiro'))
    await user.click(screen.getByRole('button', { name: c.submit }))

    expect(createManualBooking).toHaveBeenCalledTimes(1)
    const [input, token] = vi.mocked(createManualBooking).mock.calls[0]!
    expect(token).toBe('csrf-tok')
    expect(input).toMatchObject({
      requestedVehicleId: 'veh-1',
      pickupLocationId: 'loc-1',
      dropoffLocationId: 'loc-1',
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-03T01:00:00.000Z',
      customer: { kind: 'existing', renterId: 'r-9' },
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ),
    })
  })

  it('shows guidance and hides the form when there are no vehicles to book', () => {
    renderDialog({ vehicles: [] })
    expect(screen.getByText(c.noInventory)).toBeInTheDocument()
    expect(screen.queryByLabelText(c.vehicleLabel)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: c.submit })).not.toBeInTheDocument()
  })

  it('shows guidance and hides the form when there are no stores to book against', () => {
    renderDialog({ locations: [] })
    expect(screen.getByText(c.noInventory)).toBeInTheDocument()
    expect(screen.queryByLabelText(c.locationLabel)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: c.submit })).not.toBeInTheDocument()
  })

  it('clears the typed walk-in name and phone after toggling customer modes', async () => {
    const user = userEvent.setup({ delay: null })
    renderDialog()

    await user.type(screen.getByLabelText(c.nameLabel), 'Taro Yamada')
    await user.type(screen.getByLabelText(c.phoneLabel), '09012345678')
    await user.click(screen.getByRole('button', { name: c.customerExistingTab }))
    await user.click(screen.getByRole('button', { name: c.customerNewTab }))

    expect(screen.getByLabelText(c.nameLabel)).toHaveValue('')
    expect(screen.getByLabelText(c.phoneLabel)).toHaveValue('')
  })

  it('drops a selected existing customer after toggling away and back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [tanaka] })),
    )
    const user = userEvent.setup({ delay: null })
    renderDialog({ initialRange })

    await user.click(screen.getByRole('button', { name: c.customerExistingTab }))
    await user.type(screen.getByLabelText(c.customerSearchLabel), 'tan')
    await user.click(await screen.findByText('Tanaka Hiro'))
    // The summary replaces the search box once a customer is attached.
    expect(screen.queryByLabelText(c.customerSearchLabel)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: c.customerNewTab }))
    await user.click(screen.getByRole('button', { name: c.customerExistingTab }))

    // Selection was cleared: the search box is back and no customer is attached.
    expect(screen.getByLabelText(c.customerSearchLabel)).toBeInTheDocument()
    expect(screen.queryByText('Tanaka Hiro')).not.toBeInTheDocument()
  })
})
