import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { bookingByIdQueryOptions } from '@/vite/bookings/api'
import { OperatorBookingDetail } from '@/vite/operator-bookings/OperatorBookingDetail'
import type { OperatorBookingRow } from '@/vite/operator-bookings/api'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface OperatorBookingDetailSheetProps {
  /** The row whose details to show, or null when the drawer is closed. */
  readonly row: OperatorBookingRow | null
  readonly locale: string
  readonly onClose: () => void
}

// Imperative shell for the read-only detail drawer (#512 follow-up). Owns the
// Sheet open/close and the single-booking fetch; delegates rendering to the pure
// OperatorBookingDetail. The body only mounts while a row is selected, so the
// query (and its hook) never runs with a null id.
export function OperatorBookingDetailSheet({
  row,
  locale,
  onClose,
}: OperatorBookingDetailSheetProps) {
  const t = useTranslations('bookings.operator.detail')

  return (
    <Sheet
      open={row != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('heading')}</SheetTitle>
        </SheetHeader>
        {row != null && <DetailBody row={row} locale={locale} />}
      </SheetContent>
    </Sheet>
  )
}

function DetailBody({ row, locale }: { row: OperatorBookingRow; locale: string }) {
  const t = useTranslations('bookings.operator.detail')
  const { data, isPending, isError } = useQuery(bookingByIdQueryOptions(row.id))

  if (isPending) {
    return <p className="px-4 pb-6 text-muted-foreground">{t('loading')}</p>
  }
  if (isError) {
    return <p className="px-4 pb-6 text-destructive">{t('loadError')}</p>
  }
  if (data == null) {
    return <p className="px-4 pb-6 text-muted-foreground">{t('missing')}</p>
  }
  return <OperatorBookingDetail row={row} booking={data} locale={locale} />
}
