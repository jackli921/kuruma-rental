'use client'

import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { View } from 'react-big-calendar'

interface CalendarToolbarProps {
  readonly label: string
  readonly view: View
  readonly onNavigate: (action: 'PREV' | 'NEXT' | 'TODAY') => void
  readonly onView: (view: View) => void
  readonly views?: readonly View[]
}

const VIEW_KEYS: Record<string, string> = {
  day: 'views.day',
  week: 'views.week',
  month: 'views.month',
}

export function CalendarToolbar({
  label,
  view,
  onNavigate,
  onView,
  views = ['week', 'month'],
}: CalendarToolbarProps) {
  const t = useTranslations('business.bookings.calendar')

  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" onClick={() => onNavigate('PREV')}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => onNavigate('TODAY')}>
          {t('today')}
        </Button>
        <Button variant="outline" size="icon-sm" onClick={() => onNavigate('NEXT')}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <span className="text-sm font-medium">{label}</span>

      <div className="flex items-center gap-1">
        {views.map((v) => (
          <Button
            key={v}
            variant={v === view ? 'default' : 'outline'}
            size="sm"
            onClick={() => onView(v)}
          >
            {t(VIEW_KEYS[v] ?? v)}
          </Button>
        ))}
      </div>
    </div>
  )
}
