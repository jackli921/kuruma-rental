import { EmptyState } from '@/components/EmptyState'
import { Calendar } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

export default async function ManageBookingsPage() {
  const t = await getTranslations('business.bookings')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      <EmptyState icon={Calendar} message={t('empty')} />
    </div>
  )
}
