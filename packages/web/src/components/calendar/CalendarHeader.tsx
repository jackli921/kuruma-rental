'use client'

import { Button } from '@/components/ui/button'
import { addWeeks, endOfWeek, format, startOfWeek, subWeeks } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface CalendarHeaderProps {
  readonly weekStart: Date
  readonly onWeekChange: (newStart: Date) => void
}

export function CalendarHeader({ weekStart, onWeekChange }: CalendarHeaderProps) {
  const t = useTranslations('business.bookings.calendar')
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  const handlePrev = () => onWeekChange(subWeeks(weekStart, 1))
  const handleNext = () => onWeekChange(addWeeks(weekStart, 1))
  const handleToday = () => onWeekChange(startOfWeek(new Date(), { weekStartsOn: 1 }))

  const sameMonth = weekStart.getMonth() === weekEnd.getMonth()
  const dateLabel = sameMonth
    ? `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`
    : `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" onClick={handlePrev} aria-label="Previous week">
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={handleNext} aria-label="Next week">
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <h2 className="text-lg font-medium min-w-48">{dateLabel}</h2>
      <Button variant="outline" size="sm" onClick={handleToday}>
        {t('today')}
      </Button>
    </div>
  )
}
