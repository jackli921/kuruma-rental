import { BookingsCalendar } from '@/vite/operator-bookings/BookingsCalendar'
import type { CalendarEvent, CalendarResource } from '@/vite/operator-bookings/calendar-events'
import { render } from '@testing-library/react'
import type { SlotInfo } from 'react-big-calendar'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
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
        events={[] as readonly CalendarEvent[]}
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
