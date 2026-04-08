'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { Calendar, MapPin, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'
import { buttonVariants } from '../ui/button'

export function SearchWidget() {
  const t = useTranslations('landing.hero')
  const router = useRouter()
  const [pickupDate, setPickupDate] = useState('')
  const [returnDate, setReturnDate] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()

    const params = new URLSearchParams()
    if (pickupDate) params.set('from', pickupDate)
    if (returnDate) params.set('to', returnDate)

    const query = params.toString()
    const href = query ? `/vehicles?${query}` : '/vehicles'
    router.push(href)
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
            type="date"
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
            type="date"
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
