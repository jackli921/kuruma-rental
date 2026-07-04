import { RegionCascade } from '@/vite/operator-locations/RegionCascade'
import type { RegionNode } from '@kuruma/shared/types/region'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('RegionCascade (#651 Slice 2b, #1276 city-as-terminal)', () => {
  it('shows only prefecture enabled initially; city disabled, area not yet rendered', () => {
    setup()
    expect(screen.getByLabelText('Prefecture')).toBeEnabled()
    expect(screen.getByLabelText('City')).toBeDisabled()
    expect(screen.queryByLabelText('Area')).not.toBeInTheDocument()
  })

  it('emits the city id when an assignable city is selected (city is terminal)', async () => {
    const user = userEvent.setup()
    const onChange = setup()
    await user.selectOptions(screen.getByLabelText('Prefecture'), 'reg_osaka')
    await user.selectOptions(screen.getByLabelText('City'), 'reg_osaka_city')

    expect(onChange).toHaveBeenLastCalledWith('reg_osaka_city')
  })

  it('renders no area dropdown for an assignable city with no area children', async () => {
    const user = userEvent.setup()
    const onChange = setup()
    await user.selectOptions(screen.getByLabelText('Prefecture'), 'reg_kyoto')
    await user.selectOptions(screen.getByLabelText('City'), 'reg_kyoto_city')

    expect(onChange).toHaveBeenLastCalledWith('reg_kyoto_city')
    expect(screen.queryByLabelText('Area')).not.toBeInTheDocument()
  })

  it('lets an area refine an assignable city, overriding the city as the terminal', async () => {
    const user = userEvent.setup()
    const onChange = setup()
    await user.selectOptions(screen.getByLabelText('Prefecture'), 'reg_osaka')
    await user.selectOptions(screen.getByLabelText('City'), 'reg_osaka_city')
    await user.selectOptions(screen.getByLabelText('Area'), 'reg_namba')

    expect(onChange).toHaveBeenLastCalledWith('reg_namba')
  })

  it('lists only assignable, ACTIVE areas (excludes INACTIVE + navigation-only)', async () => {
    const user = userEvent.setup()
    setup()
    await user.selectOptions(screen.getByLabelText('Prefecture'), 'reg_osaka')
    await user.selectOptions(screen.getByLabelText('City'), 'reg_osaka_city')

    expect(screen.getByRole('option', { name: 'Namba' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Umeda' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Retired' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'NavOnly' })).not.toBeInTheDocument()
  })

  it('prefills the prefecture -> city -> area chain from an existing AREA value', () => {
    setup('reg_namba')
    expect(screen.getByLabelText('Prefecture')).toHaveValue('reg_osaka')
    expect(screen.getByLabelText('City')).toHaveValue('reg_osaka_city')
    expect(screen.getByLabelText('Area')).toHaveValue('reg_namba')
  })

  it('prefills the prefecture -> city chain from an existing CITY value', () => {
    setup('reg_osaka_city')
    expect(screen.getByLabelText('Prefecture')).toHaveValue('reg_osaka')
    expect(screen.getByLabelText('City')).toHaveValue('reg_osaka_city')
    // The city is the terminal, so the (optional) area select stays on its placeholder.
    expect(screen.getByLabelText('Area')).toHaveValue('')
  })

  it('clears the value to null and resets the city when the prefecture changes', async () => {
    const user = userEvent.setup()
    const onChange = setup('reg_namba')
    await user.selectOptions(screen.getByLabelText('Prefecture'), 'reg_kyoto')
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.getByLabelText('City')).toHaveValue('')
  })

  it('keeps a now-unselectable assigned region visible (INACTIVE) instead of blanking', () => {
    setup('reg_retired')
    expect(screen.getByLabelText('Area')).toHaveValue('reg_retired')
    expect(screen.getByRole('option', { name: 'Retired' })).toBeInTheDocument()
  })

  it('renders without crashing when the assigned region is unknown (since deleted)', () => {
    setup('reg_gone')
    expect(screen.getByLabelText('Area')).toHaveValue('reg_gone')
  })
})
