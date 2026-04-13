'use client'

import type { CalendarBooking } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { SOURCE_COLORS } from './calendar-utils'

interface BookingBlockProps {
  readonly booking: CalendarBooking
  readonly variant: 'bar' | 'chip'
  readonly onClick: () => void
}

function getSourceColor(source: string): { bg: string; text: string } {
  return SOURCE_COLORS[source] ?? SOURCE_COLORS.OTHER!
}

export function BookingBlock({ booking, variant, onClick }: BookingBlockProps) {
  const colors = getSourceColor(booking.source)

  if (variant === 'chip') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight',
          'cursor-pointer hover:brightness-110 transition-all',
          colors.bg,
          colors.text,
        )}
      >
        <span
          className={cn('size-1.5 shrink-0 rounded-full', colors.text)}
          style={{ backgroundColor: 'currentColor' }}
        />
        <span className="truncate">
          {format(new Date(booking.startAt), 'HH:mm')}
          {booking.renterName ? ` ${booking.renterName}` : ''}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute inset-x-0.5 overflow-hidden rounded px-1.5 py-0.5 text-[11px] leading-tight',
        'cursor-pointer hover:brightness-110 transition-all',
        colors.bg,
        colors.text,
      )}
    >
      <span className="font-medium">
        {format(new Date(booking.startAt), 'HH:mm')} - {format(new Date(booking.endAt), 'HH:mm')}
      </span>
      {booking.renterName && (
        <span className="block truncate opacity-80">{booking.renterName}</span>
      )}
    </button>
  )
}
