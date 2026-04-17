import { buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Link } from '@/i18n/routing'
import { countryFlag } from '@/lib/country-flag'
import { formatDateTime, formatJpy } from '@/lib/format'
import type { Customer } from '@kuruma/shared/types/customer'
import { getTranslations } from 'next-intl/server'

type Sort = 'lastBookingAt' | 'bookingCount' | 'name'

interface Props {
  customers: Customer[]
  locale: string
  nextCursor: string | null
  currentSort: Sort
  search: string
}

export async function CustomerTable({ customers, locale, nextCursor, currentSort, search }: Props) {
  const t = await getTranslations('business.customers')

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <SortLink sort="name" currentSort={currentSort} search={search}>
                {t('columns.name')}
              </SortLink>
            </TableHead>
            <TableHead>{t('columns.email')}</TableHead>
            <TableHead>{t('columns.country')}</TableHead>
            <TableHead className="text-right">
              <SortLink sort="bookingCount" currentSort={currentSort} search={search}>
                {t('columns.bookingCount')}
              </SortLink>
            </TableHead>
            <TableHead className="text-right">{t('columns.totalSpent')}</TableHead>
            <TableHead>
              <SortLink sort="lastBookingAt" currentSort={currentSort} search={search}>
                {t('columns.lastBookingAt')}
              </SortLink>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((c) => (
            <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50">
              <TableCell className="font-medium">
                <Link href={`/manage/customers/${c.id}`} className="hover:underline">
                  {c.name ?? t('unnamed')}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{c.email}</TableCell>
              <TableCell>
                <span aria-label={c.country ?? ''} className="text-lg">
                  {countryFlag(c.country)}
                </span>
              </TableCell>
              <TableCell className="text-right">{c.bookingCount}</TableCell>
              <TableCell className="text-right">{formatJpy(c.totalSpent)}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateTime(c.lastBookingAt, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {nextCursor ? (
        <div className="p-4 border-t border-border flex justify-center">
          <Link
            href={`/manage/customers?${buildQuery({ search, sort: currentSort, cursor: nextCursor })}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('loadMore')}
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function SortLink({
  sort,
  currentSort,
  search,
  children,
}: {
  sort: Sort
  currentSort: Sort
  search: string
  children: React.ReactNode
}) {
  const isActive = currentSort === sort
  return (
    <Link
      href={`/manage/customers?${buildQuery({ search, sort })}`}
      className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${
        isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
      aria-current={isActive ? 'true' : undefined}
    >
      {children}
      {isActive ? <span aria-hidden>↓</span> : null}
    </Link>
  )
}

function buildQuery({
  search,
  sort,
  cursor,
}: {
  search?: string
  sort?: Sort
  cursor?: string
}): string {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (sort) params.set('sort', sort)
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}
