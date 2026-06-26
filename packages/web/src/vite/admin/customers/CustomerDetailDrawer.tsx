import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDateTime, formatJpy } from '@/lib/format'
import type { CustomerWithBookings } from '@kuruma/shared/types/customer'
import { useLocale, useTranslations } from 'use-intl'

interface CustomerDetailDrawerProps {
  readonly customer: CustomerWithBookings | null
  readonly open: boolean
  readonly isLoading: boolean
  readonly onOpenChange: (open: boolean) => void
}

// Right-side drawer showing one customer's profile + cross-operator booking
// history. Pure presentation: the route owns the `customerByIdQueryOptions` read
// and the open/selected state. Renders a loading line while the detail is in
// flight and an empty-state when the lookup resolved to null (deleted user).
export function CustomerDetailDrawer({
  customer,
  open,
  isLoading,
  onOpenChange,
}: CustomerDetailDrawerProps) {
  const t = useTranslations('admin.customers')
  const locale = useLocale()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{customer?.name ?? t('unnamed')}</SheetTitle>
          <SheetDescription>{customer?.email ?? t('noEmail')}</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <p className="px-4 py-6 text-muted-foreground">{t('detailLoading')}</p>
        ) : customer === null ? (
          <p className="px-4 py-6 text-muted-foreground">{t('detailEmpty')}</p>
        ) : (
          <div className="space-y-6 px-4 pb-6">
            <dl className="grid grid-cols-2 gap-4">
              <Stat label={t('colBookings')} value={customer.bookingCount.toLocaleString()} />
              <Stat label={t('colTotalSpent')} value={formatJpy(customer.totalSpent)} />
              <Stat label={t('colCountry')} value={customer.country ?? '—'} />
              <Stat label={t('colLanguage')} value={customer.language} />
            </dl>

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{t('bookingsTitle')}</h3>
              {customer.bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('bookingsEmpty')}</p>
              ) : (
                <ul className="space-y-2">
                  {customer.bookings.map((booking) => (
                    <li key={booking.id} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{booking.vehicleName ?? t('noVehicle')}</span>
                        <span className="text-muted-foreground">
                          {t(`status.${booking.status}`)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-muted-foreground">
                        <span>{formatDateTime(booking.startAt, locale)}</span>
                        <span className="tabular-nums">
                          {booking.totalPrice === null ? '—' : formatJpy(booking.totalPrice)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
