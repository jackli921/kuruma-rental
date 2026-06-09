import type { SearchResultsData } from '@kuruma/shared/types/search-result'
import { Search } from 'lucide-react'
import { useTranslations } from 'use-intl'
import { SearchResultRow } from './SearchResultRow'

interface SearchResultsListProps {
  /** null = no valid date range yet → show the date prompt (mirrors the store grid). */
  readonly result: SearchResultsData | null
}

/**
 * Flat cross-operator vehicle list (#458, Slice D). Slice E layers a map pane
 * beside this same list; the list itself is the standalone, demoable view. A
 * `null` result means "pick dates first"; an empty `items` means "nothing free
 * for these dates".
 */
export function SearchResultsList({ result }: SearchResultsListProps) {
  const t = useTranslations('search')

  if (result === null) {
    return <p className="py-12 text-center text-muted-foreground">{t('needDates')}</p>
  }

  if (result.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Search className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('list.empty')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {result.items.map((item) => (
        <SearchResultRow key={keyFor(item)} item={item} />
      ))}
    </div>
  )
}

/** Stable list key — the renter-safe per-car id for SPECIFIC, the class id for a
 *  future CLASS_COMBO row (#464). */
function keyFor(item: SearchResultsData['items'][number]): string {
  return item.kind === 'SPECIFIC' ? item.vehicleId : item.classId
}
