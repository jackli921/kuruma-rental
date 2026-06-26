import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { CustomerSort } from '@kuruma/shared/types/customer'
import { useTranslations } from 'use-intl'

const SORTS: readonly CustomerSort[] = ['lastBookingAt', 'bookingCount', 'name']

interface CustomerSearchBarProps {
  readonly search: string
  readonly onSearchChange: (value: string) => void
  readonly sort: CustomerSort
  readonly onSortChange: (sort: CustomerSort) => void
}

// Search + sort controls for the customer directory. Pure (FC/IS): the route
// owns the debounced query state and turns these callbacks into refetches. Search
// is a controlled `type="search"` input with a real `<label>`; sort mirrors the
// API's `ALLOWED_SORTS` so a value can't drift from what the server accepts.
export function CustomerSearchBar({
  search,
  onSearchChange,
  sort,
  onSortChange,
}: CustomerSearchBarProps) {
  const t = useTranslations('admin.customers')

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1">
        <label htmlFor="customer-search" className="text-sm text-muted-foreground">
          {t('searchLabel')}
        </label>
        <Input
          id="customer-search"
          type="search"
          value={search}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="customer-sort" className="text-sm text-muted-foreground">
          {t('sortLabel')}
        </label>
        <NativeSelect
          id="customer-sort"
          className="w-auto"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as CustomerSort)}
        >
          {SORTS.map((option) => (
            <option key={option} value={option}>
              {t(`sort.${option}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  )
}
