import { AssignVehicleDialog } from '@/vite/operator-bookings/AssignVehicleDialog'
import * as api from '@/vite/operator-bookings/api'
import {
  type SubstitutionCandidate,
  bookingEventsQueryOptions,
  operatorBookingDetailQueryOptions,
} from '@/vite/operator-bookings/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// needsAssignment query key — Task 10 (the worklist) will use the same key.
const NEEDS_ASSIGNMENT_KEY = ['operator-bookings', 'needs-assignment'] as const
const CALENDAR_KEY = ['operator-bookings', 'calendar'] as const

const sub = enMessages.bookings.operator.detail.substitute
const assign = enMessages.bookings.operator.detail.assign

function candidate(over: Partial<SubstitutionCandidate> = {}): SubstitutionCandidate {
  return { id: 'veh-2', name: 'Toyota Aqua', licensePlate: 'OSAKA 5678', ...over }
}

function renderDialog(
  candidates: SubstitutionCandidate[],
  queryClient = new QueryClient(),
  candidatesError = false,
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <AssignVehicleDialog
          bookingId="bk-1"
          candidates={candidates}
          candidatesError={candidatesError}
          csrfToken="csrf-tok"
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AssignVehicleDialog', () => {
  it('lists candidate vehicles (name + plate) when the trigger is opened', async () => {
    const user = userEvent.setup()
    renderDialog([
      candidate(),
      candidate({ id: 'veh-3', name: 'Mazda 2', licensePlate: 'KYOTO 1' }),
    ])

    await user.click(screen.getByRole('button', { name: assign.action }))

    expect(screen.getByRole('option', { name: /Toyota Aqua/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Mazda 2/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /OSAKA 5678/ })).toBeInTheDocument()
  })

  it('submit is disabled when no vehicle is selected (empty candidates)', async () => {
    const user = userEvent.setup()
    renderDialog([])

    await user.click(screen.getByRole('button', { name: assign.action }))

    expect(screen.getByRole('button', { name: assign.submit })).toBeDisabled()
  })

  it('submits the picked vehicle id + reason + csrf and invalidates the right query keys', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'assignVehicle').mockResolvedValue({} as never)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderDialog([candidate(), candidate({ id: 'veh-3', name: 'Mazda 2' })], queryClient)

    await user.click(screen.getByRole('button', { name: assign.action }))
    await user.selectOptions(screen.getByRole('combobox'), 'veh-3')
    await user.type(screen.getByLabelText(sub.reasonLabel), 'pre-delivery check')
    await user.click(screen.getByRole('button', { name: assign.submit }))

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('bk-1', 'veh-3', 'pre-delivery check', 'csrf-tok'),
    )
    // Booking detail + events (same as substitute dialog).
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: operatorBookingDetailQueryOptions('bk-1').queryKey,
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: bookingEventsQueryOptions('bk-1').queryKey,
    })
    // needsAssignment worklist — Task 10 reuses this exact key.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: NEEDS_ASSIGNMENT_KEY })
    // Calendar — the booking now has an assigned vehicle; columns must refresh.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CALENDAR_KEY })
    // Dialog closes on success.
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  })

  it('passes null reason when the field is left blank', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'assignVehicle').mockResolvedValue({} as never)
    renderDialog([candidate()])

    await user.click(screen.getByRole('button', { name: assign.action }))
    await user.click(screen.getByRole('button', { name: assign.submit }))

    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'veh-2', null, 'csrf-tok'))
  })

  it('collapses a whitespace-only reason to null', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'assignVehicle').mockResolvedValue({} as never)
    renderDialog([candidate()])

    await user.click(screen.getByRole('button', { name: assign.action }))
    await user.type(screen.getByLabelText(sub.reasonLabel), '   ')
    await user.click(screen.getByRole('button', { name: assign.submit }))

    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'veh-2', null, 'csrf-tok'))
  })

  it('shows the empty state and disables submit when there are no candidates', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'assignVehicle')
    renderDialog([])

    await user.click(screen.getByRole('button', { name: assign.action }))

    expect(screen.getByText(sub.noCandidates)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: assign.submit })).toBeDisabled()
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows a load-error message (not the empty state) when the candidate fetch failed', async () => {
    const user = userEvent.setup()
    renderDialog([], new QueryClient(), true)

    await user.click(screen.getByRole('button', { name: assign.action }))

    expect(screen.getByText(sub.loadError)).toBeInTheDocument()
    expect(screen.queryByText(sub.noCandidates)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: assign.submit })).toBeDisabled()
  })

  it('surfaces an error message when the assign mutation fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'assignVehicle').mockRejectedValue(new Error('409'))
    renderDialog([candidate()])

    await user.click(screen.getByRole('button', { name: assign.action }))
    await user.click(screen.getByRole('button', { name: assign.submit }))

    expect(await screen.findByText(assign.error)).toBeInTheDocument()
  })
})
