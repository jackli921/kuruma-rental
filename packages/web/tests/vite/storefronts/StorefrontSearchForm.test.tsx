// #965 replaced the two raw `datetime-local` inputs with the controlled
// DateTimeRangePicker. The old #392 pre-hydration DOM-read hack is retired (the
// web is a pure Vite SPA now), so the form reads the range from React state.
import { REGIONS_QUERY_KEY } from '@/vite/regions/regions-api'
import { StorefrontSearchForm } from '@/vite/storefronts/StorefrontSearchForm'
import { readPersistedRange } from '@/vite/storefronts/storage'
import { ACRISS_CODES } from '@kuruma/shared'
import type { RegionNode } from '@kuruma/shared/types/region'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }))

function makeRegion(overrides: Pick<RegionNode, 'id' | 'slug'> & Partial<RegionNode>): RegionNode {
  return {
    parentId: null,
    nameEn: 'Region',
    nameJa: '地域',
    nameZh: '地区',
    type: 'AREA',
    latitude: null,
    longitude: null,
    assignable: true,
    status: 'ACTIVE',
    sortOrder: 0,
    ...overrides,
  }
}

// A minimal taxonomy so the picker's quick-pick chips (namba/umeda) render.
const REGIONS: RegionNode[] = [
  makeRegion({ id: 'reg_osaka', slug: 'osaka', type: 'PREFECTURE', nameEn: 'Osaka' }),
  makeRegion({
    id: 'reg_osaka_city',
    slug: 'osaka-city',
    type: 'CITY',
    nameEn: 'Osaka City',
    parentId: 'reg_osaka',
  }),
  makeRegion({ id: 'reg_namba', slug: 'namba', nameEn: 'Namba', parentId: 'reg_osaka_city' }),
  makeRegion({ id: 'reg_umeda', slug: 'umeda', nameEn: 'Umeda', parentId: 'reg_osaka_city' }),
]

function renderForm(
  props: {
    defaultFrom?: string
    defaultTo?: string
    classFilter?: string | string[]
    region?: string
  } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(REGIONS_QUERY_KEY, REGIONS)
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        <StorefrontSearchForm {...props} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('StorefrontSearchForm', () => {
  afterEach(() => {
    mockNavigate.mockClear()
    sessionStorage.clear()
    cleanup()
  })

  it('renders the controlled picker seeded from the prefill, not raw datetime inputs', () => {
    const { container } = renderForm({
      defaultFrom: '2026-07-01T10:00',
      defaultTo: '2026-07-03T10:00',
    })
    // The native inputs are gone; the picker trigger (labeled "Pickup & return")
    // summarizes the seeded range as its visible content.
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull()
    expect(container.querySelector('#from')).toBeNull()
    expect(screen.getByRole('button', { name: 'Pickup & return' })).toBeInTheDocument()
    expect(screen.getByText(/Jul 1 10:00 → Jul 3 10:00/)).toBeInTheDocument()
  })

  it('prefills from defaults and carries them on submit', () => {
    const { container } = renderForm({
      defaultFrom: '2026-08-01T09:00',
      defaultTo: '2026-08-02T09:00',
    })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-08-01T09:00', to: '2026-08-02T09:00' },
    })
  })

  it('persists the submitted range so the hero remembers a refinement made here', () => {
    const { container } = renderForm({
      defaultFrom: '2026-09-10T12:00',
      defaultTo: '2026-09-13T12:00',
    })

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(readPersistedRange()).toEqual({ from: '2026-09-10T12:00', to: '2026-09-13T12:00' })
  })

  it('renders a selectable class chip for each ACRISS code, labeled from the acriss namespace', () => {
    renderForm()

    expect(screen.getAllByRole('checkbox')).toHaveLength(Object.keys(ACRISS_CODES).length)
    expect(screen.getByRole('checkbox', { name: 'Compact' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'SUV' })).toBeInTheDocument()
  })

  it('pre-checks the chips named by the classFilter prop (round-trip from the URL)', () => {
    renderForm({ classFilter: ['CCAR'] })

    expect(screen.getByRole('checkbox', { name: 'Compact' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'SUV' })).not.toBeChecked()
  })

  it('pushes the checked class codes as the repeatable class param on submit', () => {
    const { container } = renderForm({
      defaultFrom: '2026-07-01T10:00',
      defaultTo: '2026-07-03T10:00',
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compact' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'SUV' }))

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-07-01T10:00', to: '2026-07-03T10:00', class: ['CCAR', 'SUVR'] },
    })
  })

  it('omits the class param when no chip is checked (clean URL)', () => {
    const { container } = renderForm({
      defaultFrom: '2026-07-01T10:00',
      defaultTo: '2026-07-03T10:00',
    })

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-07-01T10:00', to: '2026-07-03T10:00' },
    })
  })

  it('threads the chosen region slug into the search navigation (#651 Slice 3)', () => {
    const { container } = renderForm({
      defaultFrom: '2026-07-01T10:00',
      defaultTo: '2026-07-03T10:00',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Namba' }))
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-07-01T10:00', to: '2026-07-03T10:00', region: 'namba' },
    })
  })

  it('round-trips the region prop back into the navigation', () => {
    const { container } = renderForm({
      defaultFrom: '2026-07-01T10:00',
      defaultTo: '2026-07-03T10:00',
      region: 'umeda',
    })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/$locale/search',
      params: { locale: 'en' },
      search: { from: '2026-07-01T10:00', to: '2026-07-03T10:00', region: 'umeda' },
    })
  })
})
