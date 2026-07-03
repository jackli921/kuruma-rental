import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { FleetTimeline } from './FleetTimeline'
import type { CalendarBookingRow } from './api'
import type { BlockCalendarEvent } from './calendar-events'

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
