import { Link } from '@/i18n/routing'
import { useTranslations } from 'next-intl'

interface BookingDetailStubProps {
  readonly id: string
}

export function BookingDetailStub({ id }: BookingDetailStubProps) {
  const t = useTranslations('business.bookings.detail')

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('stubTitle')}</h1>
      <p className="text-sm text-muted-foreground">{t('stubBody', { id })}</p>
      <Link
        href="/manage/bookings"
        className="inline-block text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        {t('backToCalendar')}
      </Link>
    </div>
  )
}
