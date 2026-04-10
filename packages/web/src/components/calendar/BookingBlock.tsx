'use client'

import type { CalendarBooking } from '@/lib/calendar'
import { cn } from '@/lib/utils'

type BookingStatus = CalendarBooking['status']

const STATUS_COLORS: Record<BookingStatus, string> = {
  CONFIRMED:
    'bg-green-200 border-green-400 text-green-900 dark:bg-green-900 dark:border-green-700 dark:text-green-100',
  ACTIVE:
    'bg-blue-200 border-blue-400 text-blue-900 dark:bg-blue-900 dark:border-blue-700 dark:text-blue-100',
  COMPLETED:
    'bg-gray-200 border-gray-400 text-gray-700 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300',
  CANCELLED:
    'bg-red-200 border-red-400 text-red-900 dark:bg-red-900 dark:border-red-700 dark:text-red-100',
}

interface BookingBlockProps {
  readonly booking: CalendarBooking
  readonly style: React.CSSProperties
  readonly onClick?: (booking: CalendarBooking) => void
}

export function BookingBlock({ booking, style, onClick }: BookingBlockProps) {
  return (
    <button
      type="button"
      className={cn(
        'absolute top-0.5 bottom-0.5 rounded border text-[10px] leading-tight px-1 py-0.5 overflow-hidden truncate cursor-pointer hover:opacity-80 transition-opacity',
        STATUS_COLORS[booking.status],
      )}
      style={style}
      onClick={() => onClick?.(booking)}
      title={`${booking.status} | ${new Date(booking.startAt).toLocaleTimeString()} - ${new Date(booking.endAt).toLocaleTimeString()}`}
    >
      {booking.status}
    </button>
  )
}
