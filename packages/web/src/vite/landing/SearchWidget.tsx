import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { defaultSearchRange } from '@/vite/storefronts/params'
import { persistSearchRange, readPersistedRange } from '@/vite/storefronts/storage'
import { useNavigate } from '@tanstack/react-router'
import { Calendar, MapPin, Search } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'

// Prefill the inputs so a renter can search in one click: restore this session's
// last range if there is one, otherwise the next-hour / +3 day default.
function initialRange(): { from: string; to: string } {
  return readPersistedRange() ?? defaultSearchRange()
}

export function SearchWidget() {
  const t = useTranslations('landing.hero')
  const locale = useLocale()
  const navigate = useNavigate()
  // Compute the seed once on mount (reads sessionStorage); the two inputs then
  // own their own state. Calling initialRange() per useState would read storage
  // and build a Date twice.
  const [initial] = useState(initialRange)
  const [pickupDate, setPickupDate] = useState(initial.from)
  const [returnDate, setReturnDate] = useState(initial.to)

  // Hand the chosen range to the storefront availability search. The inputs are
  // `datetime-local` (JST wall-clock) to match StorefrontSearchForm, so the
  // values feed `/search`'s parseSearchRange directly — no format conversion.
  // Persist first so returning to the landing page restores this range.
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    persistSearchRange(pickupDate, returnDate)
    navigate({
      to: '/$locale/search',
      params: { locale },
      search: { from: pickupDate, to: returnDate },
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-10 bg-white rounded-2xl shadow-xl p-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 max-w-2xl"
    >
      {/* Location (static) */}
      <div className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl">
        <MapPin className="size-5 text-muted-foreground shrink-0" />
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('search.location')}</p>
          <p className="text-sm font-semibold text-foreground">{t('search.locationValue')}</p>
        </div>
      </div>

      <div className="hidden sm:block w-px h-8 bg-border" />

      {/* Pickup date */}
      <div className="flex-1 flex items-center gap-3 px-4 py-2 rounded-xl">
        <Calendar className="size-5 text-muted-foreground shrink-0" />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="pickup-date" className="text-xs font-medium text-muted-foreground">
            {t('search.pickupDate')}
          </Label>
          <Input
            id="pickup-date"
            type="datetime-local"
            value={pickupDate}
            onChange={(e) => setPickupDate(e.target.value)}
            className="h-6 border-0 p-0 text-sm font-semibold shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      <div className="hidden sm:block w-px h-8 bg-border" />

      {/* Return date */}
      <div className="flex-1 flex items-center gap-3 px-4 py-2 rounded-xl">
        <Calendar className="size-5 text-muted-foreground shrink-0" />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="return-date" className="text-xs font-medium text-muted-foreground">
            {t('search.returnDate')}
          </Label>
          <Input
            id="return-date"
            type="datetime-local"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            className="h-6 border-0 p-0 text-sm font-semibold shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      {/* Search button */}
      <button
        type="submit"
        className={cn(
          buttonVariants({ size: 'lg' }),
          'bg-red-600 hover:bg-red-700 text-white rounded-xl px-6 h-12 text-base font-semibold shrink-0',
        )}
      >
        <Search className="size-4 mr-2" />
        {t('search.button')}
      </button>
    </form>
  )
}
