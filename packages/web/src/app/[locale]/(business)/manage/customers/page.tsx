import { EmptyState } from '@/components/EmptyState'
import { CustomerSearch } from '@/components/customers/CustomerSearch'
import { CustomerTable } from '@/components/customers/CustomerTable'
import { listCustomers } from '@/lib/customers'
import { Users } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'

interface PageProps {
  searchParams: Promise<{ search?: string; sort?: string; cursor?: string }>
}

const ALLOWED_SORTS = new Set(['lastBookingAt', 'bookingCount', 'name'])

export default async function ManageCustomersPage({ searchParams }: PageProps) {
  const t = await getTranslations('business.customers')
  const locale = await getLocale()
  const { search, sort, cursor } = await searchParams
  const sortParam =
    sort && ALLOWED_SORTS.has(sort)
      ? (sort as 'lastBookingAt' | 'bookingCount' | 'name')
      : undefined

  const args: Parameters<typeof listCustomers>[0] = {}
  const trimmed = search?.trim()
  if (trimmed) args.search = trimmed
  if (sortParam) args.sort = sortParam
  if (cursor) args.cursor = cursor
  const { customers, nextCursor } = await listCustomers(args)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>

      <div className="mt-6">
        <CustomerSearch defaultValue={search ?? ''} />
      </div>

      {customers.length === 0 ? (
        <EmptyState icon={Users} message={t('empty')} />
      ) : (
        <div className="mt-6">
          <CustomerTable
            customers={customers}
            locale={locale}
            nextCursor={nextCursor}
            currentSort={sortParam ?? 'lastBookingAt'}
            search={search ?? ''}
          />
        </div>
      )}
    </div>
  )
}
