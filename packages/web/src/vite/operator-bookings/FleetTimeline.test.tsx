import '@testing-library/jest-dom/vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { FleetTimeline } from './FleetTimeline'
import type { CalendarBookingRow } from './api'
import type { BlockCalendarEvent } from './calendar-events'
import { shiftCalendarDate } from './calendar-view'

const VEHICLES = [
  { id: 'v1', name: 'Corolla' },
  { id: 'v2', name: 'Hiace' },
]

function row(over: Partial<CalendarBookingRow> & { id: string }): CalendarBookingRow {
  return {
    bookingCode: `CODE-${over.id}`,
    status: 'CONFIRMED',
    startAt: '2026-07-03T09:00:00.000Z',
    endAt: '2026-07-04T09:00:00.000Z',
    effectiveEndAt: '2026-07-04T09:00:00.000Z',
    vehicleId: 'v1',
    renterName: null,
    renterEmail: null,
    totalPrice: null,
    ...over,
  }
}

function block(over: Partial<BlockCalendarEvent> = {}): BlockCalendarEvent {
  return {
    type: 'block',
    id: 'blk1',
    title: 'Maintenance',
    start: new Date('2026-07-03T09:00:00.000Z'),
    end: new Date('2026-07-04T09:00:00.000Z'),
    resourceId: 'v1',
    kind: 'MAINTENANCE',
    reason: 'Maintenance',
    notes: null,
    ...over,
  }
}

interface RenderOpts {
  onSelectEvent?: (id: string) => void
  onSelectBlock?: (block: BlockCalendarEvent) => void
  blocks?: BlockCalendarEvent[]
}

function renderTimeline(rows: CalendarBookingRow[], opts: RenderOpts = {}) {
  const { onSelectEvent = vi.fn(), onSelectBlock = vi.fn(), blocks = [] } = opts
  return render(
    <IntlProvider locale="en" messages={en}>
      <FleetTimeline
        rows={rows}
        vehicles={VEHICLES}
        blocks={blocks}
        date={new Date('2026-07-01T00:00:00.000Z')}
        locale="en"
        onViewChange={vi.fn()}
        onDateChange={vi.fn()}
        onSelectEvent={onSelectEvent}
        onSelectBlock={onSelectBlock}
      />
    </IntlProvider>,
  )
}

describe('FleetTimeline', () => {
  it('renders a row per fleet vehicle', () => {
    renderTimeline([row({ id: 'b1', renterName: 'Alice' })])
    expect(screen.getByText('Corolla')).toBeInTheDocument()
    expect(screen.getByText('Hiace')).toBeInTheDocument()
  })

  it('adds an Unassigned row only when a class-only float is present', () => {
    const { rerender } = renderTimeline([row({ id: 'b1', vehicleId: 'v1' })])
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()

    rerender(
      <IntlProvider locale="en" messages={en}>
        <FleetTimeline
          rows={[row({ id: 'b2', vehicleId: null, renterName: 'Bob' })]}
          vehicles={VEHICLES}
          blocks={[]}
          date={new Date('2026-07-01T00:00:00.000Z')}
          locale="en"
          onViewChange={vi.fn()}
          onDateChange={vi.fn()}
          onSelectEvent={vi.fn()}
          onSelectBlock={vi.fn()}
        />
      </IntlProvider>,
    )
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('opens the clicked booking, stripping the turnaround tail', () => {
    const onSelectEvent = vi.fn()
    // A booking whose effective end runs past its booked end → a booked bar plus a
    // turnaround tail bar, both titled "Alice". Clicking either must open b1.
    renderTimeline(
      [
        row({
          id: 'b1',
          renterName: 'Alice',
          endAt: '2026-07-04T09:00:00.000Z',
          effectiveEndAt: '2026-07-04T15:00:00.000Z',
        }),
      ],
      { onSelectEvent },
    )
    const bars = screen.getAllByText('Alice')
    expect(bars.length).toBeGreaterThan(0)
    const bar = bars[0]?.closest('.rct-item')
    expect(bar).not.toBeNull()
    fireEvent.mouseDown(bar as Element)
    fireEvent.mouseUp(bar as Element)
    expect(onSelectEvent).toHaveBeenCalledWith('b1')
  })

  it('paints a scheduled block with its kind band class, not a booking status', () => {
    renderTimeline([], { blocks: [block({ kind: 'MAINTENANCE' })] })
    const bar = screen.getByText('Maintenance').closest('.rct-item')
    expect(bar).not.toBeNull()
    expect(bar).toHaveClass('rbc-event--block-maintenance')
    expect(bar).not.toHaveClass('rbc-event--confirmed')
  })

  it('opens the block detail (not a booking) when a block band is clicked', () => {
    const onSelectEvent = vi.fn()
    const onSelectBlock = vi.fn()
    const blk = block({ id: 'blk7', title: 'Bodywork', reason: 'Bodywork' })
    renderTimeline([], { blocks: [blk], onSelectEvent, onSelectBlock })
    const bar = screen.getByText('Bodywork').closest('.rct-item')
    fireEvent.mouseDown(bar as Element)
    fireEvent.mouseUp(bar as Element)
    expect(onSelectBlock).toHaveBeenCalledWith(blk)
    expect(onSelectEvent).not.toHaveBeenCalled()
  })
})

// #1349: the board was mouse-only (no keyboard/ARIA on bars), gating the GA flag
// flip. Each interactive bar is now a focusable, screen-reader-labelled button that
// opens the same detail on Enter/Space that a click opens; the whole board is a
// labelled region. The pure timeline-layout tests pin WHICH bars are interactive
// (one stop per booking); these pin how the shell renders that.
describe('FleetTimeline keyboard + ARIA (#1349)', () => {
  it('exposes a booking bar as a button naming the vehicle, renter, and status', () => {
    renderTimeline([row({ id: 'b1', renterName: 'Alice' })])
    expect(
      screen.getByRole('button', { name: /Corolla\. Booking: Alice, Confirmed/ }),
    ).toBeInTheDocument()
  })

  it('opens the booking on Enter — keyboard parity with click', () => {
    const onSelectEvent = vi.fn()
    renderTimeline([row({ id: 'b1', renterName: 'Alice' })], { onSelectEvent })
    fireEvent.keyDown(screen.getByRole('button', { name: /Booking: Alice/ }), { key: 'Enter' })
    expect(onSelectEvent).toHaveBeenCalledWith('b1')
  })

  it('activates on Space and prevents the default page scroll', () => {
    const onSelectEvent = vi.fn()
    renderTimeline([row({ id: 'b1', renterName: 'Alice' })], { onSelectEvent })
    const bar = screen.getByRole('button', { name: /Booking: Alice/ })
    const ev = createEvent.keyDown(bar, { key: ' ' })
    fireEvent(bar, ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(onSelectEvent).toHaveBeenCalledWith('b1')
  })

  it('exposes a scheduled block as a button and opens the block (not a trip) on Enter', () => {
    const onSelectEvent = vi.fn()
    const onSelectBlock = vi.fn()
    const blk = block({ id: 'blk7', title: 'Bodywork', reason: 'Bodywork', kind: 'MAINTENANCE' })
    renderTimeline([], { blocks: [blk], onSelectEvent, onSelectBlock })
    fireEvent.keyDown(
      screen.getByRole('button', { name: /Corolla\. Maintenance block: Bodywork/ }),
      { key: 'Enter' },
    )
    expect(onSelectBlock).toHaveBeenCalledWith(blk)
    expect(onSelectEvent).not.toHaveBeenCalled()
  })

  it('promises a dialog only on block bars — a booking bar navigates, so it must not', () => {
    // aria-haspopup="dialog" is a contract that activation opens an overlay. A block bar
    // opens BlockDetailDialog (true); a booking bar navigates to a full page (false), so
    // announcing a dialog would misinform screen-reader users — the defect this GA-gate fixes.
    const blk = block({ id: 'blk7', title: 'Bodywork', reason: 'Bodywork', kind: 'MAINTENANCE' })
    renderTimeline([row({ id: 'b1', renterName: 'Alice' })], { blocks: [blk] })
    expect(screen.getByRole('button', { name: /Maintenance block: Bodywork/ })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    )
    expect(screen.getByRole('button', { name: /Booking: Alice/ })).not.toHaveAttribute(
      'aria-haspopup',
    )
  })

  it('makes a booking exactly one keyboard stop, aria-hiding the redundant turnaround tail', () => {
    // Booked + tail both in-window: the booked band is the sole button; the tail bar
    // still renders for mouse users but is removed from the a11y tree (no second stop).
    renderTimeline([
      row({
        id: 'b1',
        renterName: 'Alice',
        endAt: '2026-07-04T09:00:00.000Z',
        effectiveEndAt: '2026-07-04T15:00:00.000Z',
      }),
    ])
    expect(screen.getAllByRole('button', { name: /Booking: Alice/ })).toHaveLength(1)
    expect(document.querySelector('.rct-item[aria-hidden="true"]')).not.toBeNull()
  })

  it('labels the whole board as a region for screen-reader navigation', () => {
    renderTimeline([row({ id: 'b1', renterName: 'Alice' })])
    expect(screen.getByRole('region', { name: /Fleet planning board/ })).toBeInTheDocument()
  })
})

// #1471 (follow-up to #1349): after a date-range nav, keyboard/screen-reader focus can be
// orphaned to <body>. When focus sat on a booking bar and that booking leaves the new
// window, buildTimelineLayout clamps it out, React unmounts the focused bar node, and the
// browser drops focus to <body>. It surfaces with VoiceOver/Safari, where clicking the
// toolbar's Next does not first move focus to the button; Chromium masks it by focusing the
// button on click. The board must return focus to the labelled region — a stable anchor
// that always exists — while leaving focus alone when a live control (the Next button)
// drove the nav.
describe('FleetTimeline focus restoration after date navigation (#1471)', () => {
  const DATE0 = new Date('2026-07-01T00:00:00.000Z')
  // +14 days: Alice's 2026-07-03 booking falls wholly before the new window, so its bar
  // (and the node that held focus) is removed — the reported focus-loss trigger.
  const DATE_NEXT = shiftCalendarDate('timeline', DATE0, 1)
  const alice = (): CalendarBookingRow => row({ id: 'b1', renterName: 'Alice' })

  function element(date: Date, rows: CalendarBookingRow[]) {
    return (
      <IntlProvider locale="en" messages={en}>
        <FleetTimeline
          rows={rows}
          vehicles={VEHICLES}
          blocks={[]}
          date={date}
          locale="en"
          onViewChange={vi.fn()}
          onDateChange={vi.fn()}
          onSelectEvent={vi.fn()}
          onSelectBlock={vi.fn()}
        />
      </IntlProvider>
    )
  }

  it('returns focus to the board region when a nav orphans the focused bar', () => {
    const { rerender } = render(element(DATE0, [alice()]))
    const bar = screen.getByRole('button', { name: /Booking: Alice/ })
    bar.focus()
    expect(bar).toHaveFocus()

    rerender(element(DATE_NEXT, [alice()]))

    // The booking left the window, so the bar that held focus is unmounted...
    expect(screen.queryByRole('button', { name: /Booking: Alice/ })).not.toBeInTheDocument()
    // ...and focus is reclaimed to the always-present region, not dropped to <body>.
    expect(screen.getByRole('region', { name: /Fleet planning board/ })).toHaveFocus()
  })

  it('leaves focus on the toolbar control that drove the nav — never steals it', () => {
    // When the Next button itself held focus (it survives the re-render), the restoration
    // must not yank focus to the region, or rapid prev/next navigation would break. Guards
    // against the fix regressing to an unconditional "always focus the region on nav".
    const { rerender } = render(element(DATE0, [alice()]))
    const next = screen.getByRole('button', { name: 'Next' })
    next.focus()
    expect(next).toHaveFocus()

    rerender(element(DATE_NEXT, [alice()]))

    expect(next).toHaveFocus()
  })
})
