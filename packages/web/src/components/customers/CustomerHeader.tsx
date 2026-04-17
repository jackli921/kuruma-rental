import { countryFlag } from '@/lib/country-flag'
import { formatJpy } from '@/lib/format'
import type { CustomerWithBookings } from '@kuruma/shared/types/customer'
import { getTranslations } from 'next-intl/server'

export async function CustomerHeader({ customer }: { customer: CustomerWithBookings }) {
  const t = await getTranslations('business.customers')

  return (
    <header className="flex items-baseline justify-between flex-wrap gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {customer.name ?? t('unnamed')}{' '}
          <span aria-label={customer.country ?? ''} className="text-2xl align-middle">
            {countryFlag(customer.country)}
          </span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{customer.email}</p>
      </div>
      <dl className="grid grid-cols-3 gap-6 text-right">
        <Stat label={t('columns.bookingCount')} value={customer.bookingCount} />
        <Stat label={t('columns.totalSpent')} value={formatJpy(customer.totalSpent)} />
        <Stat label={t('language')} value={customer.language.toUpperCase()} />
      </dl>
    </header>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  )
}
