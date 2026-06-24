import type { MapAdapter } from '@/vite/search/MapAdapter'
import { MobileMapSheet } from '@/vite/search/MobileMapSheet'
import type { SearchResultItem, SpecificSearchResult } from '@kuruma/shared/types/search-result'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The base-ui Sheet is portal-backed and flaky to *open* in happy-dom (see
// MobileMenu.test). Passthrough it so the content renders inline and these tests
// assert the map/carousel wiring, not base-ui's portal open state. SheetContent
// stands in as the dialog so queries can scope to "what's inside the sheet".
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ render }: { render: ReactElement }) => render,
  SheetContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="sheet-content">{children}</div>
  ),
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

// Stand-in for any map library: one `pin-<id>` slot per item, filled by the
// view's `renderPin`. Asserts the MapAdapterProps seam — no real tiles.
const FakeMapAdapter: MapAdapter = ({ items, selectedId, renderPin }) => (
  <div data-testid="fake-map" data-selected={selectedId ?? ''}>
    {items.map((item) => (
      <div key={item.location.locationId} data-testid={`pin-${item.location.locationId}`}>
        {renderPin?.(item, { selected: item.location.locationId === selectedId })}
      </div>
    ))}
  </div>
)

function carAt(vehicleId: string, name: string, locationId: string): SpecificSearchResult {
  return {
    kind: 'SPECIFIC',
    location: {
      locationId,
      operatorId: 'op_best',
      operatorName: 'Best Car Rental',
      name: locationId === 'loc_namba' ? 'Namba' : 'Umeda',
      address: 'Osaka',
      latitude: 34.66,
      longitude: 135.5,
    },
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    classLabel: 'Compact',
    acrissCode: 'CCAR',
    seats: 5,
    photos: [],
    vehicleId,
    name,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    transmission: 'AUTO',
  }
}

function renderSheet(opts: {
  items: SearchResultItem[]
  selectedId?: string | null
  onSelect?: (id: string) => void
}) {
  const onSelect = opts.onSelect ?? (() => {})
  return render(
    <IntlProvider locale="en" messages={en}>
      <MobileMapSheet
        items={opts.items}
        adapter={FakeMapAdapter}
        selectedId={opts.selectedId ?? null}
        onSelect={onSelect}
        anchor={null}
        renderPin={(item) => (
          <button type="button" onClick={() => onSelect(item.location.locationId)}>
            {item.name}
          </button>
        )}
        renderCarousel={(item) => <div data-testid="carousel">{item.name}</div>}
      />
    </IntlProvider>,
  )
}

describe('MobileMapSheet (#885 slice 4 — mobile Map toggle)', () => {
  it('renders no Map affordance at all when nothing is geocoded', () => {
    const { container } = renderSheet({ items: [] })
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: /^map$/i })).toBeNull()
  })

  it('offers a "Map" button that hosts the full-screen map with a pin per location', () => {
    renderSheet({ items: [carAt('v1', 'Toyota Yaris', 'loc_namba')] })

    expect(screen.getByRole('button', { name: /^map$/i })).toBeInTheDocument()
    const dialog = screen.getByTestId('sheet-content')
    expect(within(dialog).getByTestId('fake-map')).toBeInTheDocument()
    expect(within(dialog).getByTestId('pin-loc_namba')).toBeInTheDocument()
  })

  it('reports the tapped pin back through onSelect (pin → selection sync)', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderSheet({ items: [carAt('v1', 'Toyota Yaris', 'loc_namba')], onSelect })

    const dialog = screen.getByTestId('sheet-content')
    await user.click(within(within(dialog).getByTestId('pin-loc_namba')).getByRole('button'))

    expect(onSelect).toHaveBeenCalledWith('loc_namba')
  })

  it('shows no bottom carousel until a location is selected', () => {
    renderSheet({ items: [carAt('v1', 'Toyota Yaris', 'loc_namba')], selectedId: null })
    expect(screen.queryByTestId('carousel')).toBeNull()
  })

  it('renders the bottom carousel for the selected location', () => {
    renderSheet({
      items: [carAt('v1', 'Toyota Yaris', 'loc_namba')],
      selectedId: 'loc_namba',
    })
    const carousel = within(screen.getByTestId('sheet-content')).getByTestId('carousel')
    expect(carousel).toHaveTextContent('Toyota Yaris')
  })

  it('ignores a selection that is not a geocoded pin (no stray carousel)', () => {
    renderSheet({
      items: [carAt('v1', 'Toyota Yaris', 'loc_namba')],
      selectedId: 'loc_ghost',
    })
    expect(screen.queryByTestId('carousel')).toBeNull()
  })
})
