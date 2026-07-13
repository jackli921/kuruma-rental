import type { RegionNode } from '@kuruma/shared/types/region'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { RegionPicker } from './RegionPicker'

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

// A Kansai subset: 2 prefectures, 3 cities, 4 assignable areas with real coords.
const REGIONS: RegionNode[] = [
  makeRegion({
    id: 'reg_osaka',
    slug: 'osaka',
    type: 'PREFECTURE',
    nameEn: 'Osaka',
    parentId: null,
  }),
  makeRegion({
    id: 'reg_kyoto',
    slug: 'kyoto',
    type: 'PREFECTURE',
    nameEn: 'Kyoto',
    parentId: null,
  }),
  makeRegion({
    id: 'reg_osaka_city',
    slug: 'osaka-city',
    type: 'CITY',
    nameEn: 'Osaka City',
    parentId: 'reg_osaka',
  }),
  makeRegion({
    id: 'reg_izumisano',
    slug: 'izumisano',
    type: 'CITY',
    nameEn: 'Izumisano',
    parentId: 'reg_osaka',
  }),
  makeRegion({
    id: 'reg_kyoto_city',
    slug: 'kyoto-city',
    type: 'CITY',
    nameEn: 'Kyoto City',
    parentId: 'reg_kyoto',
  }),
  makeRegion({
    id: 'reg_namba',
    slug: 'namba',
    type: 'AREA',
    nameEn: 'Namba',
    parentId: 'reg_osaka_city',
    latitude: 34.6627,
    longitude: 135.5012,
  }),
  makeRegion({
    id: 'reg_umeda',
    slug: 'umeda',
    type: 'AREA',
    nameEn: 'Umeda',
    parentId: 'reg_osaka_city',
    latitude: 34.7025,
    longitude: 135.4959,
  }),
  makeRegion({
    id: 'reg_kix',
    slug: 'kix',
    type: 'AREA',
    nameEn: 'Kansai Airport (KIX)',
    parentId: 'reg_izumisano',
    latitude: 34.4347,
    longitude: 135.2441,
  }),
  makeRegion({
    id: 'reg_kyoto_station',
    slug: 'kyoto-station',
    type: 'AREA',
    nameEn: 'Kyoto Station',
    parentId: 'reg_kyoto_city',
    latitude: 34.9858,
    longitude: 135.7588,
  }),
]

const getCurrentPosition = vi.fn()

beforeAll(() => {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  })
})

beforeEach(() => {
  getCurrentPosition.mockReset()
})

function renderPicker(props: { value?: string | null } = {}) {
  const onChange = vi.fn()
  const utils = render(
    <IntlProvider locale="en" messages={en}>
      <RegionPicker regions={REGIONS} value={props.value ?? null} onChange={onChange} />
    </IntlProvider>,
  )
  return { onChange, ...utils }
}

// Each level is a combobox; open it via its own trigger (scoped to that level's group so
// the three identical "Open options" triggers don't collide), then pick an option by name.
function openLevel(label: string) {
  const input = screen.getByLabelText(label)
  const group = input.closest('div')
  if (group === null) throw new Error(`no group for ${label}`)
  fireEvent.click(within(group).getByRole('button', { name: 'Open options' }))
}

function pickOption(name: string) {
  fireEvent.click(screen.getByRole('option', { name }))
}

describe('RegionPicker', () => {
  it('builds the prefecture dropdown from the region list', () => {
    renderPicker()
    openLevel('Prefecture')
    const optionLabels = screen.getAllByRole('option').map((option) => option.textContent)
    expect(optionLabels).toContain('Osaka')
    expect(optionLabels).toContain('Kyoto')
  })

  it('lists English options A-Z with the Anywhere default pinned first', () => {
    renderPicker()
    openLevel('Prefecture')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Anywhere',
      'Kyoto',
      'Osaka',
    ])
  })

  it('emits the prefecture slug when a prefecture is chosen', () => {
    const { onChange } = renderPicker()
    openLevel('Prefecture')
    pickOption('Osaka')
    expect(onChange).toHaveBeenCalledWith('osaka')
  })

  it('emits the city slug when a city is chosen', () => {
    const { onChange } = renderPicker({ value: 'osaka' })
    openLevel('City')
    pickOption('Osaka City')
    expect(onChange).toHaveBeenCalledWith('osaka-city')
  })

  it('emits the area slug when an area is chosen', () => {
    const { onChange } = renderPicker({ value: 'osaka-city' })
    openLevel('Area')
    pickOption('Namba')
    expect(onChange).toHaveBeenCalledWith('namba')
  })

  it('prefills all three levels from an area-slug value', () => {
    renderPicker({ value: 'namba' })
    expect(screen.getByLabelText<HTMLInputElement>('Prefecture').value).toBe('Osaka')
    expect(screen.getByLabelText<HTMLInputElement>('City').value).toBe('Osaka City')
    expect(screen.getByLabelText<HTMLInputElement>('Area').value).toBe('Namba')
  })

  it('emits the parent slug when a deeper level is cleared to its default', () => {
    // Clearing the city to "All cities" should filter to the whole prefecture, not null.
    const { onChange } = renderPicker({ value: 'osaka-city' })
    openLevel('City')
    pickOption('All cities')
    expect(onChange).toHaveBeenCalledWith('osaka')
  })

  it('emits null when the prefecture is cleared to Anywhere', () => {
    const { onChange } = renderPicker({ value: 'osaka' })
    openLevel('Prefecture')
    pickOption('Anywhere')
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('emits the chip slug when a quick pick is clicked', () => {
    const { onChange } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Namba' }))
    expect(onChange).toHaveBeenCalledWith('namba')
  })

  it('emits the nearest region slug when Near me succeeds', () => {
    getCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 34.6627, longitude: 135.5012 } } as GeolocationPosition),
    )
    const { onChange } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Near me' }))
    expect(onChange).toHaveBeenCalledWith('namba')
  })

  it('passes a timeout so a hung geolocation prompt cannot stall', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Near me' }))
    const options = getCurrentPosition.mock.calls[0]?.[2]
    expect(options).toMatchObject({ timeout: 10_000 })
  })

  it('falls back to the full list when Near me is denied', () => {
    getCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) =>
        error({ code: 1, message: 'denied' } as GeolocationPositionError),
    )
    const { onChange } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Near me' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('never requests geolocation automatically (region selection is the default anchor)', () => {
    renderPicker()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })
})
