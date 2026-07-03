import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type CustomerSearchResult, customerSearchQueryOptions } from '@/vite/operator-bookings/api'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslations } from 'use-intl'

const DEFAULT_DEBOUNCE_MS = 250
const MIN_QUERY_CHARS = 2

export interface CustomerPickerProps {
  /** The attached existing customer, or null while searching. Controlled by the
   *  dialog so it can build the booking body + gate submit on the selected id. */
  readonly selected: CustomerSearchResult | null
  readonly onSelect: (customer: CustomerSearchResult | null) => void
  /** Debounce before a keystroke fires a search; pass 0 in tests for determinism. */
  readonly debounceMs?: number
  /** #1260: a picker admin's chosen operator — scopes the search to its customers
   *  (undefined for a tenant operator, whose session cookie carries the scope). */
  readonly pickedOperatorId?: string | undefined
}

// #589 1d (slice 3): search an EXISTING renter to attach to a manual booking. The
// query hits the operator-scoped /customers/search (the server limits results to
// this operator's own prior renters — #396/#475), debounced so each keystroke does
// not fire a request. A selection lifts one CustomerSearchResult to the dialog;
// while one is attached the search UI collapses to a summary + Change affordance.
export function CustomerPicker({
  selected,
  onSelect,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  pickedOperatorId,
}: CustomerPickerProps) {
  const t = useTranslations('bookings.operator.newBooking')
  const inputId = useId()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), debounceMs)
    return () => clearTimeout(timer)
  }, [query, debounceMs])

  const search = useQuery(customerSearchQueryOptions(debounced, pickedOperatorId))

  if (selected) {
    return (
      <div className="space-y-2">
        <span className="block text-sm font-medium">{t('customerSelectedLabel')}</span>
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
          <CustomerSummary customer={selected} />
          <Button type="button" variant="outline" size="sm" onClick={() => onSelect(null)}>
            {t('customerChange')}
          </Button>
        </div>
      </div>
    )
  }

  const tooShort = debounced.trim().length < MIN_QUERY_CHARS
  const results = search.data ?? []

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{t('customerSearchLabel')}</Label>
      <Input
        id={inputId}
        type="search"
        value={query}
        placeholder={t('customerSearchPlaceholder')}
        onChange={(e) => setQuery(e.target.value)}
      />
      {tooShort ? (
        <p className="text-sm text-muted-foreground">{t('customerSearchHint')}</p>
      ) : search.isError ? (
        <output className="block text-sm text-destructive">{t('customerSearchError')}</output>
      ) : search.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('customerSearching')}</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('customerSearchEmpty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {results.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent"
                onClick={() => onSelect(customer)}
              >
                <CustomerSummary customer={customer} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Primary line is the name (or a placeholder when a quick-created row has none);
// the secondary line carries whatever contact details exist, never duplicating the
// primary so a phone-only customer reads cleanly.
function CustomerSummary({ customer }: { readonly customer: CustomerSearchResult }) {
  const t = useTranslations('bookings.operator.newBooking')
  const secondary = [customer.email, customer.phone].filter(Boolean).join(' · ')
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium">{customer.name ?? t('customerUnnamed')}</span>
      {secondary && <span className="truncate text-xs text-muted-foreground">{secondary}</span>}
    </span>
  )
}
