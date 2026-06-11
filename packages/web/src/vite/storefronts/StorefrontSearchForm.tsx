import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { persistSearchRange } from '@/vite/storefronts/storage'
import { useNavigate } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useLocale, useTranslations } from 'use-intl'

interface StorefrontSearchFormProps {
  /** Wall-clock `datetime-local` strings (JST) to prefill from the URL. */
  readonly defaultFrom?: string
  readonly defaultTo?: string
}

/**
 * Renter date-range search form (#391). Navigates to the locale-scoped search
 * route with the chosen pickup/return as `from`/`to` search params; the route
 * loader interprets them as JST (the same wall-clock convention as the booking
 * form) before hitting the API. MVP defaults pickup = return location, so no
 * location control ships here (§3).
 */
export function StorefrontSearchForm({
  defaultFrom = '',
  defaultTo = '',
}: StorefrontSearchFormProps) {
  const t = useTranslations('search')
  const locale = useLocale()
  const navigate = useNavigate()

  // Read the range from the FORM (DOM), not React state. Uncontrolled inputs
  // survive a pre-hydration fill on slow CI runners; a controlled form would
  // reconcile them back to empty on hydrate and block submit (#392 E2E flake).
  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const from = String(data.get('from') ?? '')
    const to = String(data.get('to') ?? '')
    // Remember the range so the landing hero restores a refinement made here.
    persistSearchRange(from, to)
    navigate({ to: '/$locale/search', params: { locale }, search: { from, to } })
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
