import type { BookingDto } from '@/vite/bookings/api'
import { BookingActionsPanel } from '@/vite/operator-bookings/BookingActionsPanel'
import * as api from '@/vite/operator-bookings/api'
import type { OperatorBookingDetailDto, SubstitutionCandidate } from '@/vite/operator-bookings/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const d = enMessages.bookings.operator.detail
const sub = d.substitute

function detail(over: Partial<BookingDto> = {}): OperatorBookingDetailDto {
  return {
    id: 'bk-1',
    bookingCode: 'H7K2M9PQ',
    renterId: 'r-1',
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    effectiveEndAt: '2026-07-03T01:00:00.000Z',
    status: 'CONFIRMED',
    source: 'DIRECT',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    totalPrice: 18000,
    notes: null,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    ...over,
  }
}

const candidate: SubstitutionCandidate = { id: 'veh-2', name: 'Honda Fit', licensePlate: 'OSAKA 9' }

const operatorSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: 'op_1', operatorSlug: 'acme' },
  csrfToken: 't',
}

const bypassSession: Session = {
  user: { id: 'u', role: 'PLATFORM_ADMIN' },
  csrfToken: 't',
}

function renderPanel(
  session: Session | null,
  bookingDetail: OperatorBookingDetailDto,
  candidates: SubstitutionCandidate[] = [candidate],
  pickedOperatorId?: string,
) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={enMessages}>
        <BookingActionsPanel
          detail={bookingDetail}
          session={session}
          candidates={candidates}
          pickedOperatorId={pickedOperatorId}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

// #868 cancellation is a post-MVP add-on gated behind a flag (OFF in the beta
// demo). These tests cover the feature, so enable it; the OFF case is its own test.
beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_CANCELLATION', 'true')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('BookingActionsPanel role gating', () => {
  it('renders nothing for a bypass role with no operatorId (read-only oversight)', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={enMessages}>
          <BookingActionsPanel
            detail={detail({ status: 'CONFIRMED' })}
            session={bypassSession}
            candidates={[candidate]}
          />
        </IntlProvider>
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there is no session', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={enMessages}>
          <BookingActionsPanel detail={detail()} session={null} candidates={[]} />
        </IntlProvider>
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('BookingActionsPanel actions by status', () => {
  it('offers mark-picked-up, substitute and cancel on a CONFIRMED booking', () => {
    renderPanel(operatorSession, detail({ status: 'CONFIRMED' }))
    expect(screen.getByRole('button', { name: d.markActive })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sub.action })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: d.cancelBooking.action })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: d.markCompleted })).not.toBeInTheDocument()
  })

  it('hides cancel in the beta MVP demo (cancellation flag off) but keeps the other actions', () => {
    vi.stubEnv('VITE_FEATURE_CANCELLATION', undefined)
    renderPanel(operatorSession, detail({ status: 'CONFIRMED' }))
    expect(screen.getByRole('button', { name: d.markActive })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: sub.action })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: d.cancelBooking.action })).not.toBeInTheDocument()
  })

  it('offers mark-returned and substitute, but NOT cancel, on an ACTIVE booking', () => {
    // An ACTIVE booking is already picked up: the server only cancels CONFIRMED
    // bookings (409 otherwise), so the panel must not offer a dead-end Cancel.
    // Substitute stays — the broken-car mid-rental swap allows CONFIRMED or ACTIVE.
    renderPanel(operatorSession, detail({ status: 'ACTIVE' }))
    expect(screen.getByRole('button', { name: d.markCompleted })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: d.markActive })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: sub.action })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: d.cancelBooking.action })).not.toBeInTheDocument()
  })

  it('shows the settled message and no actions on a COMPLETED booking', () => {
    renderPanel(operatorSession, detail({ status: 'COMPLETED' }))
    expect(screen.getByText(d.settled)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: d.markCompleted })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: sub.action })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: d.cancelBooking.action })).not.toBeInTheDocument()
  })

  it('shows the settled message on a CANCELLED booking', () => {
    renderPanel(operatorSession, detail({ status: 'CANCELLED' }))
    expect(screen.getByText(d.settled)).toBeInTheDocument()
  })
})

describe('BookingActionsPanel status transition', () => {
  it('advances CONFIRMED to ACTIVE with the session csrf token when mark-picked-up is clicked', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'updateBookingStatus').mockResolvedValue({} as never)
    renderPanel(operatorSession, detail({ id: 'bk-9', status: 'CONFIRMED' }))

    await user.click(screen.getByRole('button', { name: d.markActive }))

    // #1361: a tenant operator carries no picked operator, so the 4th arg is undefined.
    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-9', 'ACTIVE', 't', undefined))
  })

  it('advances ACTIVE to COMPLETED when mark-returned is clicked', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'updateBookingStatus').mockResolvedValue({} as never)
    renderPanel(operatorSession, detail({ status: 'ACTIVE' }))

    await user.click(screen.getByRole('button', { name: d.markCompleted }))

    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'COMPLETED', 't', undefined))
  })

  it('surfaces a status error when the transition fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'updateBookingStatus').mockRejectedValue(new Error('400'))
    renderPanel(operatorSession, detail({ status: 'CONFIRMED' }))

    await user.click(screen.getByRole('button', { name: d.markActive }))

    expect(await screen.findByText(d.statusError)).toBeInTheDocument()
  })
})

// #1361: a picker admin (PLATFORM_ADMIN) who has chosen an operator via the context
// picker may act on the booking here too — the #1260 API guard binds the write to that
// operator. Substitute stays operator-only (no admin substitute path — booking-authz.md).
describe('BookingActionsPanel picker-admin (#1361)', () => {
  it('lets a picker admin with a chosen operator advance, threading the picked operator', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'updateBookingStatus').mockResolvedValue({} as never)
    renderPanel(bypassSession, detail({ id: 'bk-9', status: 'CONFIRMED' }), [candidate], 'op_7')

    await user.click(screen.getByRole('button', { name: d.markActive }))

    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-9', 'ACTIVE', 't', 'op_7'))
  })

  it('offers Cancel but HIDES Substitute for a picker admin (the API 403s admin substitute)', () => {
    renderPanel(bypassSession, detail({ status: 'CONFIRMED' }), [candidate], 'op_7')
    expect(screen.getByRole('button', { name: d.cancelBooking.action })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: sub.action })).not.toBeInTheDocument()
  })

  it('still renders nothing for a picker admin who has NOT chosen an operator', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={enMessages}>
          <BookingActionsPanel
            detail={detail({ status: 'CONFIRMED' })}
            session={bypassSession}
            candidates={[candidate]}
          />
        </IntlProvider>
      </QueryClientProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
