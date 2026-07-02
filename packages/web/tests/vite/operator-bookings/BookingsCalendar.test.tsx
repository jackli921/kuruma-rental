import { todayInJst } from '@/lib/datetime'
import { BookingsCalendar } from '@/vite/operator-bookings/BookingsCalendar'
import type {
  BlockCalendarEvent,
  BookingCalendarEvent,
  CalendarItem,
  CalendarResource,
} from '@/vite/operator-bookings/calendar-events'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { EventProps, SlotInfo } from 'react-big-calendar'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// Capture the props handed to react-big-calendar's <Calendar> so the slot-selection
// seam (selectable + the SlotInfo->{start,end} adapter) can be asserted without
// driving rbc's flaky jsdom slot drag. Only the Calendar export is replaced; the
// real dateFnsLocalizer stays so @/lib/rbc-localizer still loads.
let calendarProps: Record<string, unknown> = {}
vi.mock('react-big-calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-big-calendar')>()),
  Calendar: (props: Record<string, unknown>) => {
    calendarProps = props
    return null
  },
}))

function renderCalendar(onSelectSlot?: (range: { start: Date; end: Date }) => void) {
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <BookingsCalendar
        events={[] as readonly CalendarItem[]}
        resources={[] as readonly CalendarResource[]}
        view="week"
        date={new Date('2026-07-01T00:00:00.000Z')}
        locale="en"
        onViewChange={vi.fn()}
        onDateChange={vi.fn()}
        onSelectEvent={vi.fn()}
        onSelectSlot={onSelectSlot}
      />
    </IntlProvider>,
  )
}

describe('BookingsCalendar slot-selection seam (#589 1d)', () => {
  it('un-shifts a clicked slot from the JST wall clock to the true instant (#1250)', () => {
    const onSelectSlot = vi.fn()
    renderCalendar(onSelectSlot)

    expect(calendarProps.selectable).toBe(true)

    // rbc reports a slot in the calendar's local coordinate space, which #1250 pins to
    // the JST wall clock: clicking the 10:00–12:00 gridline yields these local Dates.
    // onSelectSlot must receive the TRUE instants (10:00/12:00 JST) so the JST-anchored
    // booking/block dialog prefills the times the operator actually clicked.
    const start = new Date(2026, 6, 2, 10, 0) // local wall clock = 10:00 JST
    const end = new Date(2026, 6, 2, 12, 0)
    ;(calendarProps.onSelectSlot as (slot: SlotInfo) => void)({
      start,
      end,
      slots: [start],
      action: 'select',
    } as SlotInfo)

    expect(onSelectSlot).toHaveBeenCalledTimes(1)
    const arg = onSelectSlot.mock.calls[0]![0] as { start: Date; end: Date }
    expect(arg.start.toISOString()).toBe('2026-07-02T01:00:00.000Z') // 10:00 JST
    expect(arg.end.toISOString()).toBe('2026-07-02T03:00:00.000Z') // 12:00 JST
  })

  it('disables selection when onSelectSlot is omitted (read-only calendar)', () => {
    renderCalendar(undefined)
    expect(calendarProps.selectable).toBe(false)
  })
})

// #1250: rbc positions a band by reading its start/end LOCAL wall clock, so the
// calendar is pinned to JST by feeding rbc faux-local Dates (local wall clock = the
// Tokyo wall clock). The CalendarItem model stays true-instant; the shift lives only
// at this rbc edge (via the accessors), so onSelectEvent still hands the dialog a
// true instant. TODAY resolves to the JST calendar day for the same reason.
describe('BookingsCalendar JST placement (#1250)', () => {
  const bookingAt = (startIso: string, endIso: string): BookingCalendarEvent => ({
    type: 'booking',
    id: 'bk-1',
    title: 'Jane',
    start: new Date(startIso),
    end: new Date(endIso),
    resourceId: 'veh-1',
    status: 'CONFIRMED',
    bookingCode: 'ABCD2345',
    renterName: 'Jane',
    renterEmail: null,
    vehicleName: 'Aqua',
    totalPrice: null,
  })

  it('positions bands at the Tokyo wall clock via faux-local start/end accessors', () => {
    renderCalendar(vi.fn())
    const startAccessor = calendarProps.startAccessor as (e: CalendarItem) => Date
    const endAccessor = calendarProps.endAccessor as (e: CalendarItem) => Date
    // 01:00Z = 10:00 JST; 15:00Z = 00:00 JST the next day.
    const event = bookingAt('2026-07-02T01:00:00.000Z', '2026-07-02T15:00:00.000Z')
    const s = startAccessor(event)
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes()]).toEqual([
      2026, 6, 2, 10, 0,
    ])
    const e = endAccessor(event)
    expect([e.getMonth(), e.getDate(), e.getHours(), e.getMinutes()]).toEqual([6, 3, 0, 0])
  })

  it('navigates TODAY to the JST calendar day, not the browser-local one', () => {
    const onDateChange = vi.fn()
    render(
      <IntlProvider locale="en" messages={enMessages}>
        <BookingsCalendar
          events={[] as readonly CalendarItem[]}
          resources={[] as readonly CalendarResource[]}
          view="week"
          date={new Date('2026-07-01T00:00:00.000Z')}
          locale="en"
          onViewChange={vi.fn()}
          onDateChange={onDateChange}
          onSelectEvent={vi.fn()}
        />
      </IntlProvider>,
    )
    fireEvent.click(
      screen.getByRole('button', { name: enMessages.business.bookings.calendar.today }),
    )
    expect(onDateChange).toHaveBeenCalledTimes(1)
    const arg = onDateChange.mock.calls[0]![0] as Date
    const jst = todayInJst()
    expect([arg.getFullYear(), arg.getMonth(), arg.getDate()]).toEqual([
      jst.getFullYear(),
      jst.getMonth(),
      jst.getDate(),
    ])
  })
})

// #1099 quick-view over #1101 blocks: rbc renders each band via components.event.
// A booking becomes the interactive chip; a block stays a plain, non-interactive band
// whose click still flows through onSelectEvent to the block-detail dialog.
describe('BookingsCalendar event rendering (quick-view chip vs block band)', () => {
  // The quick-view chip (#1282) is gated by VITE_FEATURE_CALENDAR_QUICKVIEW; the
  // chip tests below opt it on, and one asserts the flag-OFF fallback. Reset per test
  // so a stub never leaks into the next.
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const bookingItem: BookingCalendarEvent = {
    type: 'booking',
    id: 'bk-1',
    title: 'Jane Doe',
    start: new Date('2026-07-01T01:00:00.000Z'),
    end: new Date('2026-07-03T02:00:00.000Z'),
    resourceId: 'veh-1',
    status: 'ACTIVE',
    bookingCode: 'ABCD2345',
    renterName: 'Jane Doe',
    renterEmail: 'jane@example.com',
    vehicleName: 'Toyota Aqua',
    totalPrice: 24000,
  }
  const blockItem: BlockCalendarEvent = {
    type: 'block',
    id: 'blk-1',
    title: 'Oil change',
    start: new Date('2026-07-02T00:00:00.000Z'),
    end: new Date('2026-07-03T00:00:00.000Z'),
    resourceId: 'veh-2',
    kind: 'MAINTENANCE',
    reason: 'Oil change',
    notes: null,
  }

  // Grab the rbc `components.event` the calendar wired, then render it in isolation
  // (scoped with `within`) so the calendar's own toolbar buttons don't leak into the
  // role query.
  function renderEvent(item: CalendarItem) {
    renderCalendar(vi.fn())
    const EventComp = (
      calendarProps.components as { event: ComponentType<EventProps<CalendarItem>> }
    ).event
    return render(
      <IntlProvider locale="en" messages={enMessages}>
        {/* biome-ignore lint/suspicious/noExplicitAny: rbc injects the rest of EventProps at runtime */}
        <EventComp {...({ event: item, title: item.title } as any)} />
      </IntlProvider>,
    )
  }

  it('wires a custom event component onto rbc', () => {
    renderCalendar(vi.fn())
    expect(typeof (calendarProps.components as { event?: unknown }).event).toBe('function')
  })

  it('renders a booking as the interactive quick-view chip (a button) when the flag is ON', () => {
    vi.stubEnv('VITE_FEATURE_CALENDAR_QUICKVIEW', 'true')
    const { container } = renderEvent(bookingItem)
    expect(within(container).getByRole('button', { name: /Jane Doe/ })).toBeInTheDocument()
  })

  it('renders a scheduled block as a plain band (no quick-view chip)', () => {
    const { container } = renderEvent(blockItem)
    expect(within(container).queryByRole('button')).toBeNull()
    expect(within(container).getByText('Oil change')).toBeInTheDocument()
  })

  it('renders a booking as a plain band (no chip) when the quick-view flag is OFF (#1329)', () => {
    vi.stubEnv('VITE_FEATURE_CALENDAR_QUICKVIEW', undefined)
    const { container } = renderEvent(bookingItem)
    expect(within(container).queryByRole('button')).toBeNull()
    expect(within(container).getByText('Jane Doe')).toBeInTheDocument()
  })

  it('keeps onSelectEvent wired so a block click still reaches the detail dialog', () => {
    renderCalendar(vi.fn())
    expect(typeof calendarProps.onSelectEvent).toBe('function')
  })
})
