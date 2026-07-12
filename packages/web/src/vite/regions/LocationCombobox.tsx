import { cn } from '@/lib/utils'
import { Combobox } from '@base-ui/react/combobox'
import type { RegionNode } from '@kuruma/shared/types/region'
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'
import { orderRegionsForLocale, regionMatchesQuery, regionName } from './region-locale'

// One reusable type-to-search + dropdown control for a single cascade level (#1543),
// used by both the public RegionPicker and the operator RegionCascade. Built on the
// base-ui Combobox (matches ui/select.tsx styling + a11y). The external contract is a
// drop-in for the old <NativeSelect>: `value`/`onChange` speak the region **id**, with
// '' meaning the pinned default option (Anywhere / All cities / All areas).

interface ComboboxItem {
  id: string
  label: string
  // null marks the pinned default ("Anywhere") sentinel; a real node otherwise.
  region: RegionNode | null
}

export interface LocationComboboxProps {
  regions: readonly RegionNode[]
  /** Selected region id, or '' for the default option. */
  value: string
  /** Emits the chosen region id, or '' when the default option is chosen or the input cleared. */
  onChange: (id: string) => void
  /** The pinned default option label, e.g. "Anywhere" / "All cities". */
  placeholder: string
  /** Input id so a sibling <Label htmlFor> associates with the control. */
  id?: string | undefined
  disabled?: boolean | undefined
  'aria-invalid'?: boolean | undefined
  'aria-describedby'?: string | undefined
}

export function LocationCombobox({
  regions,
  value,
  onChange,
  placeholder,
  id,
  disabled,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
}: LocationComboboxProps) {
  const locale = useLocale()
  const t = useTranslations('locationCombobox')

  const sentinel: ComboboxItem = { id: '', label: placeholder, region: null }
  const items: ComboboxItem[] = [
    sentinel,
    ...orderRegionsForLocale(regions, locale).map((region) => ({
      id: region.id,
      label: regionName(region, locale),
      region,
    })),
  ]
  const selected = items.find((item) => item.id === value) ?? sentinel

  // The sentinel shows only on an empty query (it is the "reset" option, not a search hit);
  // real nodes match by localized name or romanized English name, accent-insensitively.
  const filter = (item: ComboboxItem, query: string): boolean =>
    item.region === null ? query.trim() === '' : regionMatchesQuery(item.region, query, locale)

  return (
    <Combobox.Root
      items={items}
      value={selected}
      disabled={disabled}
      filter={filter}
      itemToStringLabel={(item: ComboboxItem) => item.label}
      isItemEqualToValue={(a: ComboboxItem, b: ComboboxItem) => a.id === b.id}
      onValueChange={(item: ComboboxItem | null) => onChange(item?.id ?? '')}
    >
      <div className="relative">
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-transparent py-1 pr-14 pl-3 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
          )}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-0.5">
          <Combobox.Clear
            aria-label={t('clear')}
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground data-[disabled]:hidden"
          >
            <XIcon className="size-4" />
          </Combobox.Clear>
          <Combobox.Trigger
            aria-label={t('open')}
            className="flex size-5 items-center justify-center text-muted-foreground"
          >
            <ChevronDownIcon className="size-4" />
          </Combobox.Trigger>
        </div>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50">
          <Combobox.Popup className="max-h-72 w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <Combobox.Empty className="px-2 py-1.5 text-muted-foreground">
              {t('noMatches')}
            </Combobox.Empty>
            <Combobox.List>
              {(item: ComboboxItem) => (
                <Combobox.Item
                  key={item.id || '__anywhere__'}
                  value={item}
                  className="relative flex cursor-default items-center rounded-md py-1.5 pr-8 pl-2 outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <Combobox.ItemIndicator className="absolute right-2 flex items-center">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                  {item.label}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
