import type { RegionNode } from '@kuruma/shared/types/region'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { RegionCascade } from './RegionCascade'

function makeRegion(
  overrides: Pick<RegionNode, 'id' | 'nameEn'> & Partial<RegionNode>,
): RegionNode {
  return {
    parentId: null,
    slug: null,
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

const REGIONS: RegionNode[] = [
  makeRegion({ id: 'osaka', nameEn: 'Osaka', type: 'PREFECTURE' }),
  makeRegion({ id: 'osaka_city', nameEn: 'Osaka City', type: 'CITY', parentId: 'osaka' }),
  makeRegion({ id: 'namba', nameEn: 'Namba', type: 'AREA', parentId: 'osaka_city' }),
  // An assignable AREA that has since been deactivated (still referenced by an old save).
  makeRegion({
    id: 'umeda_old',
    nameEn: 'Umeda (old)',
    type: 'AREA',
    parentId: 'osaka_city',
    status: 'INACTIVE',
  }),
]

function renderCascade(props: { value?: string | null } = {}) {
  const onChange = vi.fn()
  const utils = render(
    <IntlProvider locale="en" messages={en}>
      <RegionCascade regions={REGIONS} value={props.value ?? null} onChange={onChange} />
    </IntlProvider>,
  )
  return { onChange, ...utils }
}

function openLevel(label: string) {
  const group = screen.getByLabelText(label).closest('div')
  if (group === null) throw new Error(`no group for ${label}`)
  fireEvent.click(within(group).getByRole('button', { name: 'Open options' }))
}

const input = (label: string) => screen.getByLabelText<HTMLInputElement>(label)

describe('RegionCascade', () => {
  it('prefills the prefecture/city/area chain from an area value', () => {
    renderCascade({ value: 'namba' })
    expect(input('Prefecture').value).toBe('Osaka')
    expect(input('City').value).toBe('Osaka City')
    expect(input('Area').value).toBe('Namba')
  })

  it('emits the assignable city id as a terminal selection', () => {
    const { onChange } = renderCascade({ value: null })
    openLevel('Prefecture')
    fireEvent.click(screen.getByRole('option', { name: 'Osaka' }))
    openLevel('City')
    fireEvent.click(screen.getByRole('option', { name: 'Osaka City' }))
    expect(onChange).toHaveBeenCalledWith('osaka_city')
  })

  it('falls back to the assignable city when the area is cleared', () => {
    const { onChange } = renderCascade({ value: 'namba' })
    openLevel('Area')
    fireEvent.click(screen.getByRole('option', { name: 'Select...' }))
    expect(onChange).toHaveBeenCalledWith('osaka_city')
  })

  it('keeps a since-deactivated area visible so an edit does not blank it (M3)', () => {
    renderCascade({ value: 'umeda_old' })
    // The INACTIVE area is filtered out of the normal option set, but the current value
    // must still render as the area selection rather than a misleading placeholder.
    expect(input('Area').value).toBe('Umeda (old)')
  })

  it('resyncs the dropdowns when value changes externally (H1)', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <IntlProvider locale="en" messages={en}>
        <RegionCascade regions={REGIONS} value="namba" onChange={onChange} />
      </IntlProvider>,
    )
    expect(input('Prefecture').value).toBe('Osaka')
    expect(input('City').disabled).toBe(false)

    // An external reset (form reset / editing a different location) must reset the chain,
    // not leave the prefecture/city showing the old selection.
    rerender(
      <IntlProvider locale="en" messages={en}>
        <RegionCascade regions={REGIONS} value={null} onChange={onChange} />
      </IntlProvider>,
    )
    expect(input('Prefecture').value).not.toBe('Osaka')
    expect(input('City').disabled).toBe(true)
  })
})
