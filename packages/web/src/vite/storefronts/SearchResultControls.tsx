import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SORT_OPTIONS, type SortOption, parsePriceMax } from '@/vite/storefronts/sort'
import { useTranslations } from 'use-intl'

interface SearchResultControlsProps {
  readonly sort?: SortOption | undefined
  readonly priceMax?: number | undefined
  readonly onSortChange: (sort: SortOption) => void
  readonly onPriceMaxChange: (priceMax: number | undefined) => void
}

/**
 * Result ordering + daily-price cap for the storefront grid (#1291). Purely
 * presentational: the route owns the navigation so these controls update the URL
 * search params (preserving dates/class/region) and re-render from them. The cap
 * is a best-effort number; a blank or non-positive entry clears it.
 */
export function SearchResultControls({
  sort,
  priceMax,
  onSortChange,
  onPriceMaxChange,
}: SearchResultControlsProps) {
  const t = useTranslations('search.results')

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="search-sort">{t('sortLabel')}</Label>
        <NativeSelect
          id="search-sort"
          value={sort ?? 'nearest'}
          onChange={(e) => onSortChange(e.currentTarget.value as SortOption)}
          className="w-52"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`sort.${option}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="search-price-max">{t('priceMaxLabel')}</Label>
        <Input
          id="search-price-max"
          type="number"
          inputMode="numeric"
          min={0}
          step={1000}
          value={priceMax ?? ''}
          placeholder={t('priceMaxPlaceholder')}
          onChange={(e) => onPriceMaxChange(parsePriceMax(e.currentTarget.value))}
          className="w-36"
        />
      </div>
    </div>
  )
}
