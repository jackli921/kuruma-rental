import {
  addDays,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  endOfWeek,
  getHours,
  getMinutes,
  isAfter,
  isBefore,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

const PIXELS_PER_HOUR = 48

export function getWeekRange(date: Date): { from: string; to: string } {
  const from = startOfWeek(date, { weekStartsOn: 1 })
  const to = endOfWeek(date, { weekStartsOn: 1 })
  return { from: from.toISOString(), to: to.toISOString() }
}

export function getMonthRange(date: Date): { from: string; to: string } {
  const from = startOfMonth(date)
  const to = endOfMonth(date)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function getHourSlots(): string[] {
  return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
}

export function bookingToWeekPosition(
  startAt: string,
  endAt: string,
  dayStart: Date,
): { top: number; height: number } {
  const bookingStart = new Date(startAt)
  const bookingEnd = new Date(endAt)
  const dayEnd = endOfDay(dayStart)

  // Clamp to day boundaries
  const clampedStart = isBefore(bookingStart, dayStart) ? dayStart : bookingStart
  const clampedEnd = isAfter(bookingEnd, dayEnd) ? dayEnd : bookingEnd

  const startMinutes = differenceInMinutes(clampedStart, dayStart)
  const durationMinutes = differenceInMinutes(clampedEnd, clampedStart)

  const top = (startMinutes / 60) * PIXELS_PER_HOUR
  const height = (durationMinutes / 60) * PIXELS_PER_HOUR

  return { top, height }
}

export function splitMultiDayBooking(
  booking: { startAt: string; endAt: string },
  rangeStart: Date,
  rangeEnd: Date,
): Array<{
  date: Date
  startHour: number
  endHour: number
  isStart: boolean
  isEnd: boolean
}> {
  const bookingStart = new Date(booking.startAt)
  const bookingEnd = new Date(booking.endAt)

  // Clamp to visible range
  const effectiveStart = isBefore(bookingStart, rangeStart) ? rangeStart : bookingStart
  const effectiveEnd = isAfter(bookingEnd, rangeEnd) ? rangeEnd : bookingEnd

  const segments: Array<{
    date: Date
    startHour: number
    endHour: number
    isStart: boolean
    isEnd: boolean
  }> = []

  let current = startOfDay(effectiveStart)

  while (isBefore(current, effectiveEnd) || isSameDay(current, effectiveEnd)) {
    const dayStartTime = startOfDay(current)
    const dayEndTime = endOfDay(current)

    const segStart = isBefore(effectiveStart, dayStartTime) ? dayStartTime : effectiveStart
    const segEnd = isAfter(effectiveEnd, dayEndTime) ? dayEndTime : effectiveEnd

    // Skip if segment end is before segment start (no overlap with this day)
    if (!isBefore(segEnd, segStart)) {
      const startHour = isSameDay(segStart, dayStartTime)
        ? getHours(segStart) + getMinutes(segStart) / 60
        : 0
      // When effective end is at or past end of day (23:59:xx), treat as full day (24)
      const segEndHours = getHours(segEnd)
      const segEndMinutes = getMinutes(segEnd)
      const isAtEndOfDay = segEndHours === 23 && segEndMinutes >= 59
      const endHour =
        isAfter(effectiveEnd, dayEndTime) || isAtEndOfDay ? 24 : segEndHours + segEndMinutes / 60

      const isStart = isSameDay(effectiveStart, current) && isSameDay(bookingStart, effectiveStart)
      const isEnd = isSameDay(effectiveEnd, current) && isSameDay(bookingEnd, effectiveEnd)

      segments.push({
        date: dayStartTime,
        startHour,
        endHour,
        isStart,
        isEnd,
      })
    }

    current = addDays(current, 1)

    // Safety: break if we've gone past the range
    if (isAfter(current, addDays(rangeEnd, 1))) break
  }

  return segments
}

export const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  DIRECT: { bg: 'bg-blue-100 dark:bg-blue-900', text: 'text-blue-800 dark:text-blue-200' },
  TRIP_COM: {
    bg: 'bg-purple-100 dark:bg-purple-900',
    text: 'text-purple-800 dark:text-purple-200',
  },
  MANUAL: { bg: 'bg-amber-100 dark:bg-amber-900', text: 'text-amber-800 dark:text-amber-200' },
  OTHER: { bg: 'bg-gray-100 dark:bg-gray-900', text: 'text-gray-800 dark:text-gray-200' },
}

export const SOURCE_LABELS: Record<string, string> = {
  DIRECT: 'Direct',
  TRIP_COM: 'Trip.com',
  MANUAL: 'Manual',
  OTHER: 'Other',
}
