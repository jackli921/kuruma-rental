import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { SearchResultItem } from '@kuruma/shared/types/search-result'
import { Map as MapIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslations } from 'use-intl'
import type { MapAdapter } from './MapAdapter'

interface MobileMapSheetProps {
  /** Geocoded, deduped-by-location rows (the map's plottable set). Empty ⇒ no map. */
  readonly items: SearchResultItem[]
  /** The concrete map component, injected (#458 D1) — same one the desktop pane uses. */
  readonly adapter: MapAdapter
  /** Selection is owned by the parent and shared with the desktop pane (#885 slice 4). */
  readonly selectedId: string | null
  readonly onSelect: (selectedId: string) => void
  readonly anchor?: [number, number] | null
  /** The interactive price-pill pin, supplied by the view (identical to desktop). */
  readonly renderPin: (item: SearchResultItem, state: { selected: boolean }) => ReactNode
  /** The co-location carousel for a selected location — rendered as a bottom sheet
   *  over the full-screen map instead of an in-map pin overlay (the mobile standard). */
  readonly renderCarousel: (item: SearchResultItem) => ReactNode
}

/**
 * Mobile Map toggle (#885 slice 4). On phones the list is the default; this is the
 * Airbnb/Turo mobile pattern layered on top: a sticky "Map" pill opens a full-screen
 * map (`Sheet side="bottom"`), and tapping a pin slides a card carousel up from the
 * bottom. Desktop keeps the two-pane sticky map+list (slice 3b); this whole control
 * is `lg:hidden`. Selection is the parent's state, so opening the map already shows
 * whatever pin the list last focused, and tapping a pin here drives the same `selectedId`.
 */
export function MobileMapSheet({
  items,
  adapter: Adapter,
  selectedId,
  onSelect,
  anchor = null,
  renderPin,
  renderCarousel,
}: MobileMapSheetProps) {
  const t = useTranslations('search')
  const [open, setOpen] = useState(false)

  // No geocoded results ⇒ nothing to map; don't offer a dead Map button (the list
  // still shows every row, same as the desktop pane's empty state).
  if (items.length === 0) return null

  const selected = items.find((item) => item.location.locationId === selectedId) ?? null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Sticky pill, mobile only — desktop has the inline two-pane map instead. */}
      <div className="sticky bottom-6 z-10 mt-4 flex justify-center lg:hidden">
        <SheetTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-lg transition hover:opacity-90"
            >
              <MapIcon className="size-4" aria-hidden />
              {t('map.openMobileMap')}
            </button>
          }
        />
      </div>

      <SheetContent side="bottom" className="flex h-[90dvh] flex-col gap-0 p-0">
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle>{t('map.mobileMapTitle')}</SheetTitle>
        </SheetHeader>
        <div className="relative min-h-0 flex-1">
          <Adapter
            items={items}
            selectedId={selectedId}
            onSelect={onSelect}
            anchor={anchor}
            renderPin={renderPin}
          />
          {selected && (
            // The carousel sits over the bottom of the full-screen map; the wrapper
            // is click-through so the map stays pannable around the card.
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
              <div className="pointer-events-auto">{renderCarousel(selected)}</div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
