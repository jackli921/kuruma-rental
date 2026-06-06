'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from '@/i18n/routing'
import { useTranslations } from 'next-intl'
import type { FormEvent } from 'react'

interface StorefrontSearchFormProps {
  /** Wall-clock `datetime-local` strings (JST) to prefill from the URL. */
  defaultFrom?: string
  defaultTo?: string
}

/**
 * Renter date-range search form (#391). Pushes the chosen pickup/return times
 * as `from`/`to` query params; the server search page interprets them as JST
 * (the same wall-clock convention as the booking form) before hitting the API.
 * MVP defaults pickup = return location, so no location control ships here (§3).
 */
export function StorefrontSearchForm({
  defaultFrom = '',
  defaultTo = '',
}: StorefrontSearchFormProps) {
  const t = useTranslations('search')
  const router = useRouter()

  // Read the range from the FORM (DOM), not React state. Uncontrolled inputs
  // survive a pre-hydration fill on slow CI runners; a controlled form would
  // reconcile them back to empty on hydrate and block submit (#392 E2E flake).
  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const params = new URLSearchParams({
      from: String(data.get('from') ?? ''),
      to: String(data.get('to') ?? ''),
    })
    router.push(`/search?${params.toString()}`)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-2">
        <Label htmlFor="from">{t('fromLabel')}</Label>
        <Input id="from" name="from" type="datetime-local" defaultValue={defaultFrom} required />
      </div>
      <div className="flex-1 space-y-2">
        <Label htmlFor="to">{t('toLabel')}</Label>
        <Input id="to" name="to" type="datetime-local" defaultValue={defaultTo} required />
      </div>
      <Button type="submit" className="sm:w-auto">
        {t('submit')}
      </Button>
    </form>
  )
}
