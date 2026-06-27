import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatJpy } from '@/lib/format'
import type { Customer, CustomerSort, CustomerWithBookings } from '@kuruma/shared/types/customer'
import { useLocale, useTranslations } from 'use-intl'
import { CustomerDetailDrawer } from './CustomerDetailDrawer'
import { CustomerSearchBar } from './CustomerSearchBar'

interface CustomersViewProps {
  readonly customers: Customer[]
  readonly search: string
  readonly onSearchChange: (value: string) => void
  readonly sort: CustomerSort
  readonly onSortChange: (sort: CustomerSort) => void
  readonly onSelectCustomer: (id: string) => void
  readonly selectedCustomer: CustomerWithBookings | null
  readonly isDetailOpen: boolean
  readonly isDetailLoading: boolean
  readonly onCloseDetail: () => void
  readonly canPrev: boolean
  readonly canNext: boolean
  readonly onPrevPage: () => void
  readonly onNextPage: () => void
}

// Pure presentation of the platform-admin customer directory (#1090): search +
// sort controls, the paginated table, prev/next cursor controls, and the detail
// drawer. All data + query/cursor/selection state live in the route; this stays
// render-only so the table, pagination, and selection are unit-testable without a
// router or query client (mirrors RevenueView / DocumentsReviewView).
export function CustomersView({
  customers,
  search,
  onSearchChange,
  sort,
  onSortChange,
  onSelectCustomer,
  selectedCustomer,
  isDetailOpen,
  isDetailLoading,
  onCloseDetail,
  canPrev,
  canNext,
  onPrevPage,
  onNextPage,
}: CustomersViewProps) {
  const t = useTranslations('admin.customers')
  const locale = useLocale()

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>

      <CustomerSearchBar
        search={search}
        onSearchChange={onSearchChange}
        sort={sort}
        onSortChange={onSortChange}
      />

      {customers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colName')}</TableHead>
                <TableHead>{t('colEmail')}</TableHead>
                <TableHead className="text-right">{t('colBookings')}</TableHead>
                <TableHead className="text-right">{t('colTotalSpent')}</TableHead>
                <TableHead>{t('colLastBooking')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                      onClick={() => onSelectCustomer(customer.id)}
                    >
                      {customer.name ?? t('unnamed')}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.email ?? t('noEmail')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {customer.bookingCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatJpy(customer.totalSpent)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(customer.lastBookingAt, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <nav className="flex items-center justify-end gap-2" aria-label={t('pagination')}>
        <Button variant="outline" size="sm" disabled={!canPrev} onClick={onPrevPage}>
          {t('prev')}
        </Button>
        <Button variant="outline" size="sm" disabled={!canNext} onClick={onNextPage}>
          {t('next')}
        </Button>
      </nav>

      <CustomerDetailDrawer
        customer={selectedCustomer}
        open={isDetailOpen}
        isLoading={isDetailLoading}
        onOpenChange={(open) => {
          if (!open) onCloseDetail()
        }}
      />
    </div>
  )
}
