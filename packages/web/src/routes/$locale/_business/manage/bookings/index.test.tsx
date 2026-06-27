import { calendarRange, parseCalendarDate } from '@/vite/operator-bookings/calendar-events'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { IntlProvider } from 'use-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../../../messages/en.json'

// #1101 Slice B B5: the route wires the blocks layer onto the operator calendar. The
// rendered calendar (react-big-calendar) is stubbed to a thin harness that fires the
// click/slot callbacks the route hands it; the real dialogs are kept so the feature
// gate + click dispatch are exercised end to end. Pure transforms are unit-tested in
// calendar-events.test.ts; this proves the wiring + the admin read-only security crux.

const B = en.bookings.operator.blocks

// Hoisted handles so the vi.mock factories (lifted to the top of the file) can close
// over them and each test can flip the flags / session before rendering.
const navigate = vi.hoisted(() => vi.fn())
const flags = vi.hoisted(() => ({ blocks: false, manual: false }))
const sessionRef = vi.hoisted(() => ({ current: null as Session | null }))

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    // The file route's hooks need no router context here: a fixed locale + a fixed
    // (deterministic) week anchor, and a navigate spy to assert booking dispatch.
    createFileRoute: () => () => ({
      useParams: () => ({ locale: 'en' }),
      useSearch: () => ({ view: 'week', date: '2026-07-01' }),
      useNavigate: () => navigate,
    }),
    useRouter: () => ({ invalidate: vi.fn() }),
  }
})

vi.mock('@/vite/config', async (orig) => {
  const actual = await orig<typeof import('@/vite/config')>()
  // Keep the real isVisibleToViewer (the admin-bypass rule under test); only the
  // build-time flag readers are controllable.
  return {
    ...actual,
    isOperatorBlocksEnabled: () => flags.blocks,
    isOperatorManualBookingEnabled: () => flags.manual,
  }
})

vi.mock('@/vite/session', () => ({ useSession: () => ({ data: sessionRef.current }) }))

vi.mock('@/vite/operator-bookings/new-bookings', () => ({ markBookingsSeen: vi.fn() }))

const SLOT = {
  start: new Date('2026-07-01T01:00:00.000Z'),
  end: new Date('2026-07-01T03:00:00.000Z'),
  resourceId: 'veh-2',
}

vi.mock('@/vite/operator-bookings', async (orig) => {
  const actual = await orig<typeof import('@/vite/operator-bookings')>()
  // Replace only the heavy presentational shells; the dialogs + legend stay real.
  function CalendarStub(props: {
    events: readonly { type: string; id: string }[]
    onSelectEvent: (item: unknown) => void
    onSelectSlot?: ((range: typeof SLOT) => void) | undefined
  }) {
    const { events, onSelectEvent, onSelectSlot } = props
    const booking = events.find((e) => e.type === 'booking')
    const block = events.find((e) => e.type === 'block')
    return (
      <div>
        <div data-testid="block-count">{events.filter((e) => e.type === 'block').length}</div>
        <div data-testid="slot-enabled">{onSelectSlot ? 'on' : 'off'}</div>
        {booking && (
          <button type="button" data-testid="fire-booking" onClick={() => onSelectEvent(booking)} />
        )}
        {block && (
          <button type="button" data-testid="fire-block" onClick={() => onSelectEvent(block)} />
        )}
        <button type="button" data-testid="fire-slot" onClick={() => onSelectSlot?.(SLOT)} />
      </div>
    )
  }
  return { ...actual, BookingsCalendar: CalendarStub, CalendarSidebar: () => <div /> }
})

import { OperatorBookingsRoute } from './index'

const OPERATOR_SESSION: Session = {
  user: { id: 'u1', role: 'OPERATOR_OWNER', operatorId: 'op-1' },
  csrfToken: 'csrf-1',
}
const ADMIN_SESSION: Session = {
  user: { id: 'a1', role: 'PLATFORM_ADMIN' },
  csrfToken: 'csrf-1',
}

const { from, to } = calendarRange('week', parseCalendarDate('2026-07-01'))

const BOOKINGS = [
  {
    id: 'bk-1',
    bookingCode: 'CODE1',
    status: 'CONFIRMED' as const,
    startAt: '2026-07-01T01:00:00.000Z',
    effectiveEndAt: '2026-07-01T05:00:00.000Z',
    vehicleId: 'veh-1',
    renterName: 'Alice',
    renterEmail: null,
    totalPrice: null,
  },
]
const VEHICLES = [
  { id: 'veh-1', name: 'Prius' },
  { id: 'veh-2', name: 'Note' },
]
const BLOCKS = [
  {
    id: 'blk-1',
    vehicleId: 'veh-2',
    startAt: '2026-07-02T00:00:00.000Z',
    endAt: '2026-07-03T00:00:00.000Z',
    kind: 'MAINTENANCE' as const,
    reason: 'Oil change',
    notes: null,
  },
]

function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  // Seed the suspense loader's two reads + the additive blocks read so the route
  // renders synchronously without a network call.
  qc.setQueryData(['operator-bookings', 'calendar', from, to], BOOKINGS)
  qc.setQueryData(['operator-bookings', 'calendar', 'vehicles'], VEHICLES)
  qc.setQueryData(['operator-bookings', 'blocks', from, to], BLOCKS)
  return render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <Suspense fallback={<div>loading</div>}>
          <OperatorBookingsRoute />
        </Suspense>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  flags.blocks = false
  flags.manual = false
  sessionRef.current = null
  navigate.mockReset()
})

describe('OperatorBookingsRoute — blocks layer wiring', () => {
  it('hides the blocks layer for a non-admin operator when the flag is off', () => {
    flags.blocks = false
    sessionRef.current = OPERATOR_SESSION
    renderRoute()

    expect(screen.getByTestId('block-count').textContent).toBe('0')
    expect(screen.queryByText(B.legend.title)).toBeNull()
    expect(screen.queryByRole('button', { name: B.scheduleAction })).toBeNull()
  })

  it('shows blocks read-only to a platform admin previewing with the flag off', () => {
    flags.blocks = false
    sessionRef.current = ADMIN_SESSION
    renderRoute()

    // Visible: the admin previews the legend + block band (isVisibleToViewer bypass).
    expect(screen.getByText(B.legend.title)).not.toBeNull()
    expect(screen.getByTestId('block-count').textContent).toBe('1')

    // Read-only: no Schedule affordance and the calendar is not slot-selectable —
    // isOperatorSession(admin) is false, so canManageBlocks is false.
    expect(screen.queryByRole('button', { name: B.scheduleAction })).toBeNull()
    expect(screen.getByTestId('slot-enabled').textContent).toBe('off')

    // Opening the block shows detail but offers NO Remove action: the gate that keeps
    // an admin preview read-only even though the write API would admit the write.
    fireEvent.click(screen.getByTestId('fire-block'))
    expect(screen.getByText(B.detail.dialogTitle)).not.toBeNull()
    expect(screen.queryByRole('button', { name: B.detail.deleteAction })).toBeNull()
  })

  it('dispatches a clicked booking to its detail page and a clicked block to the detail dialog', () => {
    flags.blocks = true
    sessionRef.current = OPERATOR_SESSION
    renderRoute()

    fireEvent.click(screen.getByTestId('fire-booking'))
    expect(navigate).toHaveBeenCalledWith({
      to: '/$locale/manage/bookings/$bookingId',
      params: { locale: 'en', bookingId: 'bk-1' },
    })

    fireEvent.click(screen.getByTestId('fire-block'))
    expect(screen.getByText(B.detail.dialogTitle)).not.toBeNull()
  })

  it('forwards the slot vehicle into the schedule dialog for a managing operator', () => {
    flags.blocks = true
    flags.manual = false
    sessionRef.current = OPERATOR_SESSION
    renderRoute()

    expect(screen.getByTestId('slot-enabled').textContent).toBe('on')
    fireEvent.click(screen.getByTestId('fire-slot'))

    // The slot's resource column prefills the schedule dialog's vehicle picker (review #2).
    expect((screen.getByLabelText(B.schedule.vehicleLabel) as HTMLSelectElement).value).toBe(
      'veh-2',
    )
  })
})
