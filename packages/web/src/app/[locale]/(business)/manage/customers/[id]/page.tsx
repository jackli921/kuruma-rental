import { CustomerBookingsTable } from '@/components/customers/CustomerBookingsTable'
import { CustomerHeader } from '@/components/customers/CustomerHeader'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { getCustomerById } from '@/lib/customers'
import { ArrowLeft } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params
  const customer = await getCustomerById(id)
  if (!customer) notFound()

  const t = await getTranslations('business.customers')
  const locale = await getLocale()

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <Link
        href="/manage/customers"
        className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} gap-2`}
      >
        <ArrowLeft className="size-4" /> {t('backToList')}
      </Link>
      <CustomerHeader customer={customer} />
      <section>
        <h2 className="text-lg font-semibold mb-3">{t('bookingHistory')}</h2>
        <CustomerBookingsTable bookings={customer.bookings} locale={locale} />
      </section>
    </div>
  )
}
