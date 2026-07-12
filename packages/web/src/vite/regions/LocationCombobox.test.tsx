import type { RegionNode } from '@kuruma/shared/types/region'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'
import { LocationCombobox } from './LocationCombobox'

function makeRegion(
  overrides: Pick<RegionNode, 'id' | 'nameEn'> & Partial<RegionNode>,
): RegionNode {
  return {
    parentId: null,
    slug: null,
    nameJa: '地域',
    nameZh: '地区',
    type: 'PREFECTURE',
    latitude: null,
    longitude: null,
    assignable: true,
    status: 'ACTIVE',
    sortOrder: 0,
    ...overrides,
  }
}

// English names deliberately out of A-Z input order so the en re-sort is observable.
const REGIONS: RegionNode[] = [
  makeRegion({ id: 'osaka', nameEn: 'Osaka', nameJa: '大阪', sortOrder: 0 }),
  makeRegion({ id: 'aichi', nameEn: 'Aichi', nameJa: '愛知', sortOrder: 1 }),
  makeRegion({ id: 'kyoto', nameEn: 'Kyoto', nameJa: '京都', sortOrder: 2 }),
]

function renderCombobox(props: {
  value?: string
  locale?: 'en' | 'ja'
  regions?: RegionNode[]
}) {
  const onChange = vi.fn()
  const messages = props.locale === 'ja' ? ja : en
  const utils = render(
    <IntlProvider locale={props.locale ?? 'en'} messages={messages}>
      <LocationCombobox
        id="loc"
        regions={props.regions ?? REGIONS}
        value={props.value ?? ''}
        onChange={onChange}
        placeholder="Anywhere"
      />
    </IntlProvider>,
  )
  return { onChange, ...utils }
}

function open(name = 'Open options') {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('LocationCombobox', () => {
  it('shows the placeholder as the default option and lists every region when opened', () => {
    renderCombobox({})
    open()
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['Anywhere', 'Aichi', 'Kyoto', 'Osaka']) // en: A-Z, default pinned first
  })

  it('emits the region id when an option is selected', () => {
    const { onChange } = renderCombobox({})
    open()
    fireEvent.click(screen.getByRole('option', { name: 'Kyoto' }))
    expect(onChange).toHaveBeenCalledWith('kyoto')
  })

  it('emits an empty string when the default option is selected', () => {
    const { onChange } = renderCombobox({ value: 'kyoto' })
    open()
    fireEvent.click(screen.getByRole('option', { name: 'Anywhere' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('filters options as the user types', () => {
    renderCombobox({})
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'kyo' } })
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['Kyoto'])
  })

  it('finds a Japanese-labelled region by its romanized English name', () => {
    renderCombobox({ locale: 'ja' })
    open('選択肢を開く')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'osaka' } })
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['大阪'])
  })
})
