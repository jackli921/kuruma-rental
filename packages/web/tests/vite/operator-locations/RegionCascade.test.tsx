import { RegionCascade } from '@/vite/operator-locations/RegionCascade'
import type { RegionNode } from '@kuruma/shared/types/region'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const node = (over: Partial<RegionNode> & Pick<RegionNode, 'id' | 'type'>): RegionNode => ({
  parentId: null,
  nameEn: over.id,
  nameJa: over.id,
  nameZh: over.id,
  sortOrder: 0,
  latitude: null,
  longitude: null,
  assignable: false,
  status: 'ACTIVE',
  slug: null,
  ...over,
})

// osaka -> osaka_city (assignable, has areas) -> {namba, umeda} (+ retired INACTIVE,
//   navonly non-assignable)
// kyoto -> kyoto_city (assignable, NO areas -> a pure terminal city)
const REGIONS: RegionNode[] = [
  node({ id: 'reg_osaka', type: 'PREFECTURE', nameEn: 'Osaka' }),
  node({ id: 'reg_kyoto', type: 'PREFECTURE', nameEn: 'Kyoto' }),
  node({
    id: 'reg_osaka_city',
    type: 'CITY',
    parentId: 'reg_osaka',
    nameEn: 'Osaka City',
    assignable: true,
  }),
  node({
    id: 'reg_kyoto_city',
    type: 'CITY',
    parentId: 'reg_kyoto',
    nameEn: 'Kyoto City',
    assignable: true,
  }),
  node({
    id: 'reg_namba',
    type: 'AREA',
    parentId: 'reg_osaka_city',
    nameEn: 'Namba',
    assignable: true,
  }),
  node({
    id: 'reg_umeda',
    type: 'AREA',
    parentId: 'reg_osaka_city',
    nameEn: 'Umeda',
    assignable: true,
  }),
  node({
    id: 'reg_retired',
    type: 'AREA',
    parentId: 'reg_osaka_city',
    nameEn: 'Retired',
    assignable: true,
    status: 'INACTIVE',
  }),
  node({ id: 'reg_navonly', type: 'AREA', parentId: 'reg_osaka_city', nameEn: 'NavOnly' }),
]

function setup(value: string | null = null) {
  const onChange = vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <RegionCascade regions={REGIONS} value={value} onChange={onChange} />
    </IntlProvider>,
  )
  return onChange
}

// Each level is a combobox; open it via its own scoped trigger, then click an option.
function open(label: string) {
  const group = screen.getByLabelText(label).closest('div')
  if (group === null) throw new Error(`no group for ${label}`)
  fireEvent.click(within(group).getByRole('button', { name: 'Open options' }))
}
function pick(name: string) {
  fireEvent.click(screen.getByRole('option', { name }))
}

describe('RegionCascade (#651 Slice 2b, #1276 city-as-terminal)', () => {
  it('shows only prefecture enabled initially; city disabled, area not yet rendered', () => {
    setup()
    expect(screen.getByLabelText('Prefecture')).toBeEnabled()
    expect(screen.getByLabelText('City')).toBeDisabled()
    expect(screen.queryByLabelText('Area')).not.toBeInTheDocument()
  })

  it('emits the city id when an assignable city is selected (city is terminal)', () => {
    const onChange = setup()
    open('Prefecture')
    pick('Osaka')
    open('City')
    pick('Osaka City')
    expect(onChange).toHaveBeenLastCalledWith('reg_osaka_city')
  })

  it('renders no area dropdown for an assignable city with no area children', () => {
    const onChange = setup()
    open('Prefecture')
    pick('Kyoto')
    open('City')
    pick('Kyoto City')
    expect(onChange).toHaveBeenLastCalledWith('reg_kyoto_city')
    expect(screen.queryByLabelText('Area')).not.toBeInTheDocument()
  })

  it('lets an area refine an assignable city, overriding the city as the terminal', () => {
    const onChange = setup()
    open('Prefecture')
    pick('Osaka')
    open('City')
    pick('Osaka City')
    open('Area')
    pick('Namba')
    expect(onChange).toHaveBeenLastCalledWith('reg_namba')
  })

  it('lists only assignable, ACTIVE areas (excludes INACTIVE + navigation-only)', () => {
    setup()
    open('Prefecture')
    pick('Osaka')
    open('City')
    pick('Osaka City')
    open('Area')
    expect(screen.getByRole('option', { name: 'Namba' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Umeda' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Retired' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'NavOnly' })).not.toBeInTheDocument()
  })

  it('prefills the prefecture -> city -> area chain from an existing AREA value', () => {
    setup('reg_namba')
    expect(screen.getByLabelText('Prefecture')).toHaveValue('Osaka')
    expect(screen.getByLabelText('City')).toHaveValue('Osaka City')
    expect(screen.getByLabelText('Area')).toHaveValue('Namba')
  })

  it('prefills the prefecture -> city chain from an existing CITY value', () => {
    setup('reg_osaka_city')
    expect(screen.getByLabelText('Prefecture')).toHaveValue('Osaka')
    expect(screen.getByLabelText('City')).toHaveValue('Osaka City')
    // The city is the terminal, so the (optional) area level stays on its default option.
    expect(screen.getByLabelText('Area')).toHaveValue('Select...')
  })

  it('clears the value to null and resets the city when the prefecture changes', () => {
    const onChange = setup('reg_namba')
    open('Prefecture')
    pick('Kyoto')
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByLabelText('City')).toHaveValue('Select...')
  })

  it('keeps a now-unselectable assigned region visible (INACTIVE) instead of blanking', () => {
    setup('reg_retired')
    expect(screen.getByLabelText('Area')).toHaveValue('Retired')
    open('Area')
    expect(screen.getByRole('option', { name: 'Retired' })).toBeInTheDocument()
  })

  it('does not crash or silently blank an unknown (since-deleted) assigned region', () => {
    const onChange = setup('reg_gone')
    // No name to show, so the control falls back to its placeholder — but the controlled
    // value is never emitted away, so a blind re-save keeps the id rather than nulling it.
    expect(screen.getByLabelText('Area')).toHaveValue('Select...')
    expect(onChange).not.toHaveBeenCalled()
  })
})
