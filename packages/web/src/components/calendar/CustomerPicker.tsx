'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslations } from 'next-intl'

export interface CustomerResult {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  language: string
}

export interface CustomerPickerValue {
  mode: 'search' | 'create'
  searchQuery: string
  selectedCustomer: CustomerResult | null
  newDraft: {
    name: string
    email: string
    phone: string
    language: string
  }
}

export const INITIAL_CUSTOMER_PICKER_VALUE: CustomerPickerValue = {
  mode: 'search',
  searchQuery: '',
  selectedCustomer: null,
  newDraft: { name: '', email: '', phone: '', language: 'en' },
}

interface CustomerPickerProps {
  readonly value: CustomerPickerValue
  readonly onChange: (next: CustomerPickerValue) => void
  // Parent owns the debounced search so side-effect timing is orchestrated
  // in one place (ManualBookingDialog). This component is presentation-only.
  readonly onSearchQueryChange: (query: string) => void
  readonly searchResults: readonly CustomerResult[]
  readonly isSearching: boolean
}

export function CustomerPicker({
  value,
  onChange,
  onSearchQueryChange,
  searchResults,
  isSearching,
}: CustomerPickerProps) {
  const t = useTranslations('business.bookings.manualBooking')

  const setMode = (mode: 'search' | 'create') => onChange({ ...value, mode })

  const pickExisting = (customer: CustomerResult) =>
    onChange({ ...value, selectedCustomer: customer })

  const clearExisting = () => onChange({ ...value, selectedCustomer: null, searchQuery: '' })

  const setDraft = (patch: Partial<CustomerPickerValue['newDraft']>) =>
    onChange({ ...value, newDraft: { ...value.newDraft, ...patch } })

  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-medium mb-1">{t('customer')}</legend>

      <div className="flex gap-2">
        <Button
          variant={value.mode === 'search' ? 'default' : 'outline'}
          size="sm"
          type="button"
          onClick={() => setMode('search')}
        >
          {t('searchExisting')}
        </Button>
        <Button
          variant={value.mode === 'create' ? 'default' : 'outline'}
          size="sm"
          type="button"
          onClick={() => setMode('create')}
        >
          {t('createNew')}
        </Button>
      </div>

      {value.mode === 'search' && (
        <div className="grid gap-2">
          <Input
            placeholder={t('searchPlaceholder')}
            value={value.searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />
          {isSearching && <p className="text-xs text-muted-foreground">{t('searching')}</p>}
          {searchResults.length > 0 && !value.selectedCustomer && (
            <ul className="border rounded-md max-h-32 overflow-y-auto">
              {searchResults.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                    onClick={() => pickExisting(c)}
                  >
                    <span className="font-medium">{c.name ?? c.email ?? c.phone}</span>
                    {c.name && (
                      <span className="text-muted-foreground ml-2">{c.email ?? c.phone}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {value.selectedCustomer && (
            <div className="flex items-center justify-between bg-accent/50 rounded-md px-3 py-2 text-sm">
              <span>
                {value.selectedCustomer.name ??
                  value.selectedCustomer.email ??
                  value.selectedCustomer.phone}
                {value.selectedCustomer.name && (
                  <span className="text-muted-foreground ml-2">
                    {value.selectedCustomer.email ?? value.selectedCustomer.phone}
                  </span>
                )}
              </span>
              <Button variant="ghost" size="xs" onClick={clearExisting}>
                {t('change')}
              </Button>
            </div>
          )}
        </div>
      )}

      {value.mode === 'create' && (
        <div className="grid gap-2">
          <div>
            <Label htmlFor="mb-name">{t('name')}</Label>
            <Input
              id="mb-name"
              value={value.newDraft.name}
              onChange={(e) => setDraft({ name: e.target.value })}
              placeholder={t('namePlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="mb-email">{t('email')}</Label>
              <Input
                id="mb-email"
                type="email"
                value={value.newDraft.email}
                onChange={(e) => setDraft({ email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="mb-phone">{t('phone')}</Label>
              <Input
                id="mb-phone"
                type="tel"
                value={value.newDraft.phone}
                onChange={(e) => setDraft({ phone: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="mb-lang">{t('language')}</Label>
            <select
              id="mb-lang"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={value.newDraft.language}
              onChange={(e) => setDraft({ language: e.target.value })}
            >
              <option value="en">English</option>
              <option value="ja">Japanese</option>
              <option value="zh">Chinese</option>
            </select>
          </div>
        </div>
      )}
    </fieldset>
  )
}
