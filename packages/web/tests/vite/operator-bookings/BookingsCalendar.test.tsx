import { BookingsCalendar } from '@/vite/operator-bookings/BookingsCalendar'
import type {
  BlockCalendarEvent,
  BookingCalendarEvent,
  CalendarItem,
  CalendarResource,
} from '@/vite/operator-bookings/calendar-events'
import { render, within } from '@testing-library/react'
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
  it('enables selection and projects a clicked slot to {start,end} when onSelectSlot is given', () => {
    const onSelectSlot = vi.fn()
    renderCalendar(onSelectSlot)

    expect(calendarProps.selectable).toBe(true)

    const start = new Date('2026-07-02T01:00:00.000Z')
    const end = new Date('2026-07-02T03:00:00.000Z')
    ;(calendarProps.onSelectSlot as (slot: SlotInfo) => void)({
      start,
      end,
      slots: [start],
      action: 'select',
    } as SlotInfo)

    expect(onSelectSlot).toHaveBeenCalledTimes(1)
    expect(onSelectSlot).toHaveBeenCalledWith({ start, end })
  })

  it('disables selection when onSelectSlot is omitted (read-only calendar)', () => {
    renderCalendar(undefined)
    expect(calendarProps.selectable).toBe(false)
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
