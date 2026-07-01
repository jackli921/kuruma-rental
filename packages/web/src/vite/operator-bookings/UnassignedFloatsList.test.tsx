import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { NEEDS_ASSIGNMENT_PAGE_LIMIT } from './api'
import type { RawOperatorBooking } from './schema'

// Mock the session so csrfToken is available without a real auth flow.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'test-csrf' } }),
}))

// Mock AssignVehicleDialog — the test scope is the list (sort, badges, empty
// state). The dialog's own behaviour is covered by AssignVehicleDialog tests.
vi.mock('./AssignVehicleDialog', () => ({
  AssignVehicleDialog: ({ bookingId }: { bookingId: string }) => (
    <button type="button" data-testid={`assign-dialog-${bookingId}`}>
      Assign vehicle
    </button>
  ),
}))

import { UnassignedFloatsList } from './UnassignedFloatsList'

function makeFloat(over: Partial<RawOperatorBooking> & { id: string }): RawOperatorBooking {
  return {
    bookingCode: `CODE-${over.id}`,
    status: 'CONFIRMED',
    startAt: '2026-07-01T09:00:00.000Z',
    endAt: '2026-07-03T09:00:00.000Z',
    totalPrice: null,
    ...over,
  }
}

function makeQueryClient(floats: RawOperatorBooking[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // #1230 slice 5a: the worklist key carries the picked operator (null = no pick).
  qc.setQueryData(['operator-bookings', 'needs-assignment', null], floats)
  // Seed empty candidates for each float so the per-row substitution query
  // resolves immediately without a network call.
  for (const f of floats) {
    qc.setQueryData(['operator-bookings', 'substitution-candidates', f.id], [])
  }
  return qc
}

function renderList(floats: RawOperatorBooking[]) {
  const qc = makeQueryClient(floats)
  return render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <UnassignedFloatsList />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

const ACTIVE_FLOAT = makeFloat({ id: 'float-active', status: 'ACTIVE', bookingCode: 'ACTIVE01' })
const CONFIRMED_FLOAT = makeFloat({
  id: 'float-confirmed',
  status: 'CONFIRMED',
  bookingCode: 'CONF001',
})

describe('UnassignedFloatsList', () => {
  it('renders both floats when there are two needs-assignment bookings', () => {
    renderList([ACTIVE_FLOAT, CONFIRMED_FLOAT])
    expect(screen.getByText('ACTIVE01')).toBeTruthy()
    expect(screen.getByText('CONF001')).toBeTruthy()
  })

  it('shows the "Overdue" label on the ACTIVE float and not on CONFIRMED', () => {
    renderList([ACTIVE_FLOAT, CONFIRMED_FLOAT])
    const overdue = en.business.bookings.calendar.sidebar.floats.overdue
    expect(screen.getByText(overdue)).toBeTruthy()

    // Only one overdue label: ACTIVE gets it, CONFIRMED does not.
    expect(screen.getAllByText(overdue)).toHaveLength(1)
  })

  it('sorts ACTIVE floats above CONFIRMED floats in DOM order', () => {
    // Provide CONFIRMED first to confirm sorting is applied (not just input order).
    renderList([CONFIRMED_FLOAT, ACTIVE_FLOAT])
    const list = screen.getByRole('list')
    const items = within(list).getAllByRole('listitem')
    // First item must contain the ACTIVE booking code.
    expect(within(items[0] as HTMLElement).getByText('ACTIVE01')).toBeTruthy()
    // Second item must contain the CONFIRMED booking code.
    expect(within(items[1] as HTMLElement).getByText('CONF001')).toBeTruthy()
  })

  it('shows the exact count in the badge when below the page limit', () => {
    renderList([ACTIVE_FLOAT, CONFIRMED_FLOAT])
    expect(screen.getByRole('status').textContent).toBe('2')
  })

  it('shows a "100+" overflow badge when the worklist is capped at the page limit (#1223/#1214)', () => {
    // A capped page (floats.length === NEEDS_ASSIGNMENT_PAGE_LIMIT) means more floats
    // may exist beyond the fetched page, so the raw count would silently undercount.
    const capped = Array.from({ length: NEEDS_ASSIGNMENT_PAGE_LIMIT }, (_, i) =>
      makeFloat({ id: `float-${i}`, bookingCode: `CAP${i}` }),
    )
    renderList(capped)
    const badge = screen.getByRole('status')
    expect(badge.textContent).toBe(`${NEEDS_ASSIGNMENT_PAGE_LIMIT}+`)
    // The capped badge must carry the translated overflow label on BOTH the a11y
    // affordance and the hover title (sighted users only see "100+").
    const expectedLabel = en.business.bookings.calendar.sidebar.floats.overflowLabel.replaceAll(
      '{limit}',
      String(NEEDS_ASSIGNMENT_PAGE_LIMIT),
    )
    expect(badge.getAttribute('aria-label')).toBe(expectedLabel)
    expect(badge.getAttribute('title')).toBe(expectedLabel)
  })

  it('renders the empty-state copy when there are no floats', () => {
    renderList([])
    const empty = en.business.bookings.calendar.sidebar.floats.empty
    expect(screen.getByText(empty)).toBeTruthy()
  })

  it('wires the assign dialog to the correct booking id for each row', () => {
    renderList([ACTIVE_FLOAT, CONFIRMED_FLOAT])
    // Each row carries an assign button linked to its booking's id.
    expect(screen.getByTestId('assign-dialog-float-active')).toBeTruthy()
    expect(screen.getByTestId('assign-dialog-float-confirmed')).toBeTruthy()
  })
})
