import { cn } from '@/lib/utils'
import { Link } from '@tanstack/react-router'
import { LayoutGrid, MapPinned } from 'lucide-react'
import { useTranslations } from 'use-intl'

export type ResultView = 'stores' | 'map'

interface SearchViewToggleProps {
  readonly view: ResultView
  readonly locale: string
}

const SEGMENT_CLASS =
  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm text-muted-foreground hover:text-foreground'

/**
 * URL-driven `Stores | Map` segmented control (#458). View state lives in the
 * `?view` search param so it is shareable and survives a reload. Active state is
 * `aria-current="page"` + Tailwind `aria-[current=page]:*` (never a client active
 * class — the hydration-trap gotcha). The `search` updater preserves the existing
 * from/to/class filters; Stores clears `view` to keep the canonical URL clean.
 */
export function SearchViewToggle({ view, locale }: SearchViewToggleProps) {
  const t = useTranslations('search.view')

  return (
    <nav aria-label={t('label')} className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      <Link
        to="/$locale/search"
        params={{ locale }}
        search={(prev) => ({ ...prev, view: undefined })}
        aria-current={view === 'stores' ? 'page' : undefined}
        className={cn(SEGMENT_CLASS)}
      >
        <LayoutGrid className="size-4" />
        {t('stores')}
      </Link>
      <Link
        to="/$locale/search"
        params={{ locale }}
        search={(prev) => ({ ...prev, view: 'map' })}
        aria-current={view === 'map' ? 'page' : undefined}
        className={cn(SEGMENT_CLASS)}
      >
        <MapPinned className="size-4" />
        {t('map')}
      </Link>
    </nav>
  )
}
