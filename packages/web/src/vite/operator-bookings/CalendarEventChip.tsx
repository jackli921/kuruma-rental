import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { BookingQuickView } from '@/vite/operator-bookings/BookingQuickView'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import type { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'

const HOVER_OPEN_DELAY_MS = 120
// Grace period after the pointer leaves the trigger (or the card) before a
// hover-opened card dismisses. base-ui portals the card, so there is a physical
// gap between the chip and the popup; without this delay the mouseleave fires
// mid-transit and closes the card before the pointer can reach it — leaving the
// "View full details" link unclickable on hover (#1099 quick-view MEDIUM). The
// card's own onMouseEnter cancels the pending close, bridging the gap.
const HOVER_CLOSE_DELAY_MS = 120
// base-ui onOpenChange reasons that mean "the user dismissed the card". A
// `trigger-press` close (toggle) is deliberately NOT here: a chip click only pins.
// Typed off base-ui's reason union so a typo (which would silently fail *open* —
// the card would just never dismiss on that reason) is a compile error.
const DISMISS_REASONS = new Set<PopoverPrimitive.Root.ChangeEventReason>([
  'outside-press',
  'escape-key',
  'focus-out',
])

interface ChipProps {
  // Only bookings get a chip (the calendar wiring renders blocks plainly), so this
  // takes the base event, not the CalendarItem union — it never reads the discriminant.
  readonly event: CalendarEvent
  readonly locale: string
}

// rbc custom event component for a booking band. Renders the event title as a Popover
// trigger and a BookingQuickView card as the popup. Owns a local hover/pin state
// machine; the card is a Link so clicking it (or pressing Enter on it) opens the full
// detail page.
export function CalendarEventChip({ event, locale }: ChipProps) {
  const [hovering, setHovering] = useState(false)
  const [pinned, setPinned] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])

  const handleEnter = useCallback(() => {
    clearTimer()
    hoverTimer.current = setTimeout(() => setHovering(true), HOVER_OPEN_DELAY_MS)
  }, [clearTimer])

  // Leaving the trigger OR the card schedules a deferred close, so the pointer has
  // a grace window to cross the gap onto the card (where handleCardEnter cancels it).
  const handleLeave = useCallback(() => {
    clearTimer()
    hoverTimer.current = setTimeout(() => setHovering(false), HOVER_CLOSE_DELAY_MS)
  }, [clearTimer])

  // Pointer reached the portaled card: cancel the pending close and hold it open so
  // its "View full details" link is reachable without first pinning (#1099).
  const handleCardEnter = useCallback(() => {
    clearTimer()
    setHovering(true)
  }, [clearTimer])

  useEffect(() => clearTimer, [clearTimer])

  const handleOpenChange = useCallback(
    (next: boolean, details: PopoverPrimitive.Root.ChangeEventDetails) => {
      if (!next && DISMISS_REASONS.has(details.reason)) {
        setPinned(false)
        setHovering(false)
      }
    },
    [],
  )

  return (
    <Popover open={hovering || pinned} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        className="block h-full w-full truncate text-left"
        onClick={() => setPinned(true)}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {event.title}
      </PopoverTrigger>
      <PopoverContent
        initialFocus={false}
        className="p-0"
        onMouseEnter={handleCardEnter}
        onMouseLeave={handleLeave}
      >
        <Link
          to="/$locale/manage/bookings/$bookingId"
          params={{ locale, bookingId: event.id }}
          className="block rounded-lg p-2.5 text-inherit no-underline hover:bg-muted"
        >
          <BookingQuickView event={event} locale={locale} />
        </Link>
      </PopoverContent>
    </Popover>
  )
}
