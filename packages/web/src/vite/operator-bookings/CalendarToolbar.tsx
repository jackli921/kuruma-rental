import { Button } from '@/components/ui/button'
import type { CalendarView } from '@/vite/operator-bookings/calendar-view'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface CalendarToolbarProps {
  readonly label: string
  readonly view: CalendarView
  readonly onNavigate: (action: 'PREV' | 'NEXT' | 'TODAY') => void
  readonly onView: (view: CalendarView) => void
  readonly views?: readonly CalendarView[]
}

const VIEW_KEYS: Record<CalendarView, string> = {
  timeline: 'views.timeline',
  day: 'views.day',
  week: 'views.week',
  month: 'views.month',
}

// Custom toolbar (rbc's own is hidden via calendar-theme.css). Ported from the
// frozen Next module to the Vite shell: next-intl → use-intl, and the view type
// narrowed to our three operator views.
export function CalendarToolbar({
  label,
  view,
  onNavigate,
  onView,
  views = ['day', 'week', 'month'],
}: CalendarToolbarProps) {
  const t = useTranslations('business.bookings.calendar')

  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('previous')}
          onClick={() => onNavigate('PREV')}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => onNavigate('TODAY')}>
          {t('today')}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('next')}
          onClick={() => onNavigate('NEXT')}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
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
            {t(VIEW_KEYS[v])}
          </Button>
        ))}
      </div>
    </div>
  )
}
