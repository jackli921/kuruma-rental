import { instantToJstFauxLocal } from '@/lib/datetime'
import { render } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { FleetTimeline } from './FleetTimeline'
import type { CalendarBookingRow } from './api'

// #1250: react-calendar-timeline positions bars AND renders its axis day/hour headers
// in the browser's local tz. Capture the props FleetTimeline hands the lib (instead of
// driving the real canvas) to assert the window + bars are shifted to "faux-local" — a
// local wall clock that reads as the Tokyo wall clock — so the board reads in JST on any
// browser. The shift is uniform, so clamping (done in true time) and relative spacing
// are preserved; only the axis labels move to JST.
let timelineProps: Record<string, unknown> = {}
vi.mock('react-calendar-timeline', () => ({
  default: (props: Record<string, unknown>) => {
    timelineProps = props
    return null
  },
}))

const VEHICLES = [{ id: 'v1', name: 'Corolla' }]

function row(over: Partial<CalendarBookingRow> & { id: string }): CalendarBookingRow {
  return {
    bookingCode: `CODE-${over.id}`,
    status: 'CONFIRMED',
    startAt: '2026-07-03T01:00:00.000Z', // 10:00 JST
    endAt: '2026-07-03T05:00:00.000Z', // 14:00 JST
    effectiveEndAt: '2026-07-03T05:00:00.000Z',
    vehicleId: 'v1',
    renterName: 'Alice',
    renterEmail: null,
    totalPrice: null,
    ...over,
  }
}

function renderTimeline(rows: CalendarBookingRow[]) {
  render(
    <IntlProvider locale="en" messages={en}>
      <FleetTimeline
        rows={rows}
        vehicles={VEHICLES}
        blocks={[]}
        // Local noon of the calendar day Jul 1 (TZ-independent anchor day).
        date={new Date(2026, 6, 1, 12)}
        locale="en"
        onViewChange={vi.fn()}
        onDateChange={vi.fn()}
        onSelectEvent={vi.fn()}
        onSelectBlock={vi.fn()}
      />
    </IntlProvider>,
  )
}

const fauxMs = (iso: string) => instantToJstFauxLocal(new Date(iso)).getTime()

describe('FleetTimeline JST axis (#1250)', () => {
  it('pins the visible window to the faux-local JST planning span', () => {
    renderTimeline([row({ id: 'b1' })])
    // calendarRange('timeline', Jul 1) is the JST 14-day span [Jul 1 00:00, Jul 15 00:00)
    // JST = ['2026-06-30T15:00Z', '2026-07-14T15:00Z']; shifted to faux-local for the lib.
    expect(timelineProps.visibleTimeStart).toBe(fauxMs('2026-06-30T15:00:00.000Z'))
    expect(timelineProps.visibleTimeEnd).toBe(fauxMs('2026-07-14T15:00:00.000Z'))
  })

  it('places a booking bar at its Tokyo wall clock (10:00 JST)', () => {
    renderTimeline([row({ id: 'b1' })])
    const items = timelineProps.items as { start_time: number; end_time: number }[]
    expect(items).toHaveLength(1)
    expect(items[0]!.start_time).toBe(fauxMs('2026-07-03T01:00:00.000Z')) // 10:00 JST
    expect(items[0]!.end_time).toBe(fauxMs('2026-07-03T05:00:00.000Z')) // 14:00 JST
  })
})
