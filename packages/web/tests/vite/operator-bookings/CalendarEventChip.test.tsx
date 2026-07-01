import { CalendarEventChip } from '@/vite/operator-bookings/CalendarEventChip'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Stub the TanStack Link as a plain anchor exposing its target + carried params,
// so the chip renders without a RouterProvider (mirrors SearchResultRow.test.tsx).
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: { locale?: string; bookingId?: string }
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-bookingid={params?.bookingId}
      {...rest}
    >
      {children}
    </a>
  ),
}))

const event: CalendarEvent = {
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

// rbc passes EventProps; the chip only reads `event` + the injected `locale`.
function renderChip() {
  render(
    <IntlProvider locale="en" messages={en}>
      {/* biome-ignore lint/suspicious/noExplicitAny: rbc EventProps stub */}
      <CalendarEventChip {...({ event } as any)} locale="en" />
    </IntlProvider>,
  )
  return screen.getByRole('button', { name: /Jane Doe/ })
}

const card = () => screen.queryByText('Toyota Aqua') // unique to the open card

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('CalendarEventChip', () => {
  it('opens a transient card on hover after the delay', () => {
    const trigger = renderChip()
    expect(card()).toBeNull()
    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(120))
    expect(card()).toBeInTheDocument()
  })

  it('does not open if the pointer leaves before the delay', () => {
    const trigger = renderChip()
    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(60))
    fireEvent.mouseLeave(trigger)
    act(() => vi.advanceTimersByTime(120))
    expect(card()).toBeNull()
  })

  it('closes a hover-opened card after the grace delay when the pointer leaves (not pinned)', () => {
    const trigger = renderChip()
    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(120))
    fireEvent.mouseLeave(trigger)
    // The close is deferred by the grace window (so the pointer can reach the card),
    // so the card is still up immediately after leaving...
    expect(card()).toBeInTheDocument()
    // ...and dismisses once the grace delay elapses with no re-entry.
    act(() => vi.advanceTimersByTime(120))
    expect(card()).toBeNull()
  })

  it('keeps the card open (CTA reachable) when the pointer crosses onto the card', () => {
    const trigger = renderChip()
    fireEvent.mouseEnter(trigger)
    act(() => vi.advanceTimersByTime(120))
    fireEvent.mouseLeave(trigger) // starts the close grace timer
    // The popup element carries the bridge's onMouseEnter (fire on it directly:
    // React's synthetic mouseenter is not raised for a raw child mouseEnter in jsdom).
    const popup = document.querySelector('[data-slot="popover-content"]')
    expect(popup).not.toBeNull()
    fireEvent.mouseEnter(popup as Element) // pointer reaches the card, cancels the close
    act(() => vi.advanceTimersByTime(240)) // well past the grace delay
    expect(card()).toBeInTheDocument()
  })

  it('pins on click so the card survives a subsequent mouseleave', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    expect(card()).toBeInTheDocument()
    fireEvent.mouseLeave(trigger)
    expect(card()).toBeInTheDocument()
  })

  it('does not close a pinned card on a second chip click (reason-aware guard)', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(card()).toBeInTheDocument()
  })

  it('dismisses a pinned card on Escape', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    expect(card()).toBeInTheDocument()
    act(() => fireEvent.keyDown(document.body, { key: 'Escape' }))
    expect(card()).toBeNull()
  })

  it('dismisses a pinned card on an outside click', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    expect(card()).toBeInTheDocument()
    // base-ui's mouse outsidePress defaults to `intentional` — it dismisses on a
    // real outside *click*, not a bare pointerdown, so drive a click on the body.
    act(() => fireEvent.click(document.body))
    expect(card()).toBeNull()
  })

  it('renders the card as a Link (inside the popup) to the booking detail route', () => {
    const trigger = renderChip()
    fireEvent.click(trigger)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('data-to', '/$locale/manage/bookings/$bookingId')
    expect(link).toHaveAttribute('data-bookingid', 'bk-1')
    expect(link).toHaveAttribute('data-locale', 'en')
  })
})
