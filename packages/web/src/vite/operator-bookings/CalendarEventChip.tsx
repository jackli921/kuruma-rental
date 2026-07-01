import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { BookingQuickView } from '@/vite/operator-bookings/BookingQuickView'
import type { CalendarEvent } from '@/vite/operator-bookings/calendar-events'
import type { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'

const HOVER_OPEN_DELAY_MS = 120
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
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }, [])

  const handleEnter = useCallback(() => {
    clearTimer()
    openTimer.current = setTimeout(() => setHovering(true), HOVER_OPEN_DELAY_MS)
  }, [clearTimer])

  const handleLeave = useCallback(() => {
    clearTimer()
    setHovering(false)
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
      <PopoverContent initialFocus={false} className="p-0">
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
