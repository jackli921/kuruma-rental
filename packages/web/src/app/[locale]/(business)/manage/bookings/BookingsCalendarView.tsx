import { CalendarClock } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export async function BookingsCalendarView() {
  const t = await getTranslations('business.bookings.placeholder')

  return (
    <div className="mt-12 flex justify-center">
      <div className="max-w-lg rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
          <CalendarClock className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-medium">{t('title')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('body')}</p>
        <a
          className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline"
          href="https://github.com/jackli921/kuruma-rental/issues/54"
          rel="noreferrer"
          target="_blank"
        >
          {t('trackingLink')}
        </a>
      </div>
    </div>
  )
}
