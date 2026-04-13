'use client'

import { Button } from '@/components/ui/button'
import { addMonths, addWeeks, endOfWeek, format, startOfWeek, subMonths, subWeeks } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CalendarNavigationProps {
  readonly currentDate: Date
  readonly viewMode: 'week' | 'month'
  readonly onDateChange: (date: Date) => void
  readonly onViewModeChange: (mode: 'week' | 'month') => void
}

function formatLabel(date: Date, viewMode: 'week' | 'month'): string {
  if (viewMode === 'month') {
    return format(date, 'MMMM yyyy')
  }
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(date, { weekStartsOn: 1 })
  return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`
}

export function CalendarNavigation({
  currentDate,
  viewMode,
  onDateChange,
  onViewModeChange,
}: CalendarNavigationProps) {
  const handlePrev = () => {
    onDateChange(viewMode === 'week' ? subWeeks(currentDate, 1) : subMonths(currentDate, 1))
  }

  const handleNext = () => {
    onDateChange(viewMode === 'week' ? addWeeks(currentDate, 1) : addMonths(currentDate, 1))
  }

  const handleToday = () => {
    onDateChange(new Date())
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" onClick={handlePrev} aria-label="Previous">
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={handleToday}>
          Today
        </Button>
        <Button variant="outline" size="icon" onClick={handleNext} aria-label="Next">
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <span className="text-sm font-medium">{formatLabel(currentDate, viewMode)}</span>

      <div className="flex items-center gap-1">
        <Button
          variant={viewMode === 'week' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('week')}
        >
          Week
        </Button>
        <Button
          variant={viewMode === 'month' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewModeChange('month')}
        >
          Month
        </Button>
      </div>
    </div>
  )
}
