import { LocationForm } from '@/vite/operator-locations/LocationForm'
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

const REGIONS: RegionNode[] = [
  node({ id: 'reg_osaka', type: 'PREFECTURE', nameEn: 'Osaka' }),
  node({ id: 'reg_osaka_city', type: 'CITY', parentId: 'reg_osaka', nameEn: 'Osaka City' }),
  node({
    id: 'reg_namba',
    type: 'AREA',
    parentId: 'reg_osaka_city',
    nameEn: 'Namba',
    assignable: true,
  }),
]

function renderCreate() {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <IntlProvider locale="en" messages={en}>
      <LocationForm onSubmit={onSubmit} regions={REGIONS} />
    </IntlProvider>,
  )
  return onSubmit
}

describe('LocationForm region cascade (#651 Slice 2b)', () => {
  it('submits the chosen region id after the operator picks an area', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreate()

    await user.type(screen.getByLabelText('Location name'), 'Namba Branch')
    await user.type(screen.getByLabelText('Address'), '1-2-3 Namba, Chuo-ku')
    await user.selectOptions(screen.getByLabelText('Prefecture'), 'reg_osaka')
    await user.selectOptions(screen.getByLabelText('City'), 'reg_osaka_city')
    await user.selectOptions(screen.getByLabelText('Area'), 'reg_namba')
    await user.click(screen.getByRole('button', { name: 'Save location' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ regionId: 'reg_namba' }))
  })

  it('submits a null region when the cascade is left blank (server auto-derives)', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreate()

    await user.type(screen.getByLabelText('Location name'), 'Auto Branch')
    await user.type(screen.getByLabelText('Address'), '1-2-3 Somewhere')
    await user.click(screen.getByRole('button', { name: 'Save location' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ regionId: null }))
  })

  it('prefills the region chain in edit mode from defaultValues.regionId', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <IntlProvider locale="en" messages={en}>
        <LocationForm
          mode="edit"
          onSubmit={onSubmit}
          regions={REGIONS}
          defaultValues={{ name: 'Namba Branch', address: '1-2-3 Namba', regionId: 'reg_namba' }}
        />
      </IntlProvider>,
    )

    expect(screen.getByLabelText('Prefecture')).toHaveValue('reg_osaka')
    expect(screen.getByLabelText('City')).toHaveValue('reg_osaka_city')
    expect(screen.getByLabelText('Area')).toHaveValue('reg_namba')
  })
})
