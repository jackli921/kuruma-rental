import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDateTime, formatJpy } from '@/lib/format'
import { BOOKING_STATUSES } from '@kuruma/shared/enums'
import type { AdminBookingDto, AdminBookingsResponse } from '@kuruma/shared/types/admin-booking'
import { useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'
import type { AdminBookingFiltersInput } from './api'

interface BookingOversightViewProps {
  readonly response: AdminBookingsResponse
  readonly filters: AdminBookingFiltersInput
  /** Apply a new filter set — the route turns this into a URL navigation. */
  readonly onApplyFilters: (next: AdminBookingFiltersInput) => void
}

const DASH = '—'

// Build a clean filter object: drop empty values and always reset the cursor
// (a changed filter restarts paging at page one). Avoids explicit `undefined`
// keys, which `exactOptionalPropertyTypes` rejects.
function buildFilters(next: {
  operatorId?: string
  bookingCode?: string
  customer?: string
  status?: string
}): AdminBookingFiltersInput {
  const out: AdminBookingFiltersInput = {}
  if (next.operatorId) out.operatorId = next.operatorId
  if (next.bookingCode) out.bookingCode = next.bookingCode
  if (next.customer) out.customer = next.customer
  if (next.status) out.status = next.status
  return out
}

/**
 * Platform-admin cross-operator booking oversight (#1092, epic #1075 slice 6).
 * Pure function of props (FC/IS — the route owns the loader / useSuspenseQuery +
 * boundaries and turns onApplyFilters into a URL navigation). Renders a filter bar
 * (operator/bookingCode/customer/status), a result table that shows WHICH operator
 * owns each booking and WHO booked it, and a detail drawer on row click.
 */
export function BookingOversightView({
  response,
  filters,
  onApplyFilters,
}: BookingOversightViewProps) {
  const t = useTranslations('admin.bookings')
  const locale = useLocale()
  const [selected, setSelected] = useState<AdminBookingDto | null>(null)
  const { bookings } = response

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-muted-foreground text-sm">{t('subtitle')}</p>

      <FilterBar t={t} filters={filters} onApplyFilters={onApplyFilters} />

      {bookings.length === 0 ? (
        <p className="mt-8 text-muted-foreground text-sm">{t('empty')}</p>
      ) : (
        <BookingsTable
          t={t}
          locale={locale}
          bookings={bookings}
          onSelectBooking={setSelected}
          onFilterOperator={(operatorId) =>
            onApplyFilters(buildFilters({ ...filters, operatorId }))
          }
        />
      )}

      <BookingDetailDrawer
        t={t}
        locale={locale}
        booking={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

type T = ReturnType<typeof useTranslations<'admin.bookings'>>

function FilterBar({
  t,
  filters,
  onApplyFilters,
}: {
  readonly t: T
  readonly filters: AdminBookingFiltersInput
  readonly onApplyFilters: (next: AdminBookingFiltersInput) => void
}) {
  // Text inputs are local until submit; the status select applies immediately. A
  // new search always drops the cursor so paging restarts from page one.
  const [bookingCode, setBookingCode] = useState(filters.bookingCode ?? '')
  const [customer, setCustomer] = useState(filters.customer ?? '')

  return (
    <form
      className="mt-6 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onApplyFilters(buildFilters({ ...filters, bookingCode, customer }))
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="filter-customer" className="text-muted-foreground text-xs">
          {t('filterCustomer')}
        </label>
        <Input
          id="filter-customer"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder={t('filterCustomerPlaceholder')}
          className="w-56"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-code" className="text-muted-foreground text-xs">
          {t('filterBookingCode')}
        </label>
        <Input
          id="filter-code"
          value={bookingCode}
          onChange={(e) => setBookingCode(e.target.value)}
          placeholder={t('filterBookingCodePlaceholder')}
          className="w-44"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filter-status" className="text-muted-foreground text-xs">
          {t('filterStatus')}
        </label>
        <NativeSelect
          id="filter-status"
          className="w-44"
          value={filters.status ?? ''}
          onChange={(e) => onApplyFilters(buildFilters({ ...filters, status: e.target.value }))}
        >
          <option value="">{t('allStatuses')}</option>
          {BOOKING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <button
        type="submit"
        className="inline-flex h-9 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm hover:bg-primary/90"
      >
        {t('search')}
      </button>
      <button
        type="button"
        onClick={() => {
          setBookingCode('')
          setCustomer('')
          onApplyFilters({})
        }}
        className="inline-flex h-9 items-center rounded-lg border border-border px-4 font-medium text-sm hover:bg-muted/50"
      >
        {t('clear')}
      </button>
    </form>
  )
}

function BookingsTable({
  t,
  locale,
  bookings,
  onSelectBooking,
  onFilterOperator,
}: {
  readonly t: T
  readonly locale: string
  readonly bookings: AdminBookingDto[]
  readonly onSelectBooking: (booking: AdminBookingDto) => void
  readonly onFilterOperator: (operatorId: string) => void
}) {
  const head = 'px-3 py-2 text-left font-medium text-muted-foreground'

  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="border-border border-b bg-muted/50">
          <tr>
            <th scope="col" className={head}>
              {t('colOperator')}
            </th>
            <th scope="col" className={head}>
              {t('colBookingCode')}
            </th>
            <th scope="col" className={head}>
              {t('colCustomer')}
            </th>
            <th scope="col" className={head}>
              {t('colStatus')}
            </th>
            <th scope="col" className={head}>
              {t('colStart')}
            </th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id} className="border-border border-b last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onFilterOperator(b.operatorId)}
                  className="font-medium text-left underline-offset-2 hover:underline"
                >
                  {b.operatorName}
                </button>
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSelectBooking(b)}
                  className="font-mono text-xs underline-offset-2 hover:underline"
                >
                  {b.bookingCode}
                </button>
              </td>
              <td className="px-3 py-2">
                <span className="block">{b.renterName ?? DASH}</span>
                <span className="block text-muted-foreground text-xs">{b.renterEmail ?? DASH}</span>
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={b.status} label={t(`status.${b.status}`)} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                <time dateTime={b.startAt}>{formatDateTime(b.startAt, locale)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({
  status,
  label,
}: {
  readonly status: AdminBookingDto['status']
  readonly label: string
}) {
  const tone =
    status === 'CANCELLED'
      ? 'bg-destructive/10 text-destructive'
      : status === 'COMPLETED'
        ? 'bg-muted text-muted-foreground'
        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs ${tone}`}
    >
      {label}
    </span>
  )
}

function BookingDetailDrawer({
  t,
  locale,
  booking,
  onClose,
}: {
  readonly t: T
  readonly locale: string
  readonly booking: AdminBookingDto | null
  readonly onClose: () => void
}) {
  return (
    <Sheet open={booking !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        {booking && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono">{booking.bookingCode}</SheetTitle>
              <SheetDescription>{booking.operatorName}</SheetDescription>
            </SheetHeader>
            <dl className="space-y-4 px-4 pb-6 text-sm">
              <Field label={t('colStatus')} value={t(`status.${booking.status}`)} />
              <Field label={t('detailCustomer')} value={booking.renterName ?? DASH} />
              <Field label={t('detailEmail')} value={booking.renterEmail ?? DASH} />
              <Field label={t('detailOperatorId')} value={booking.operatorId} mono />
              <Field label={t('detailStart')} value={formatDateTime(booking.startAt, locale)} />
              <Field label={t('detailEnd')} value={formatDateTime(booking.endAt, locale)} />
              <Field
                label={t('detailTotal')}
                value={booking.totalPrice === null ? DASH : formatJpy(booking.totalPrice)}
              />
              <Field label={t('detailPickup')} value={booking.pickupLocationId} mono />
              <Field label={t('detailDropoff')} value={booking.dropoffLocationId} mono />
            </dl>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  )
}
