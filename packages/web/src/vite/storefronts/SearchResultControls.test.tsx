import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
import { SearchResultControls } from './SearchResultControls'

const T = en.search.results

function renderControls(
  over: { sort?: 'nearest' | 'priceAsc' | 'priceDesc'; priceMax?: number } = {},
) {
  const onSortChange = vi.fn()
  const onPriceMaxChange = vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <SearchResultControls
        sort={over.sort}
        priceMax={over.priceMax}
        onSortChange={onSortChange}
        onPriceMaxChange={onPriceMaxChange}
      />
    </IntlProvider>,
  )
  return { onSortChange, onPriceMaxChange }
}

describe('SearchResultControls', () => {
  it('reflects the current sort and price cap in the inputs', () => {
    renderControls({ sort: 'priceDesc', priceMax: 8000 })
    expect(screen.getByLabelText<HTMLSelectElement>(T.sortLabel).value).toBe('priceDesc')
    expect(screen.getByLabelText<HTMLInputElement>(T.priceMaxLabel).value).toBe('8000')
  })

  it('defaults the sort select to nearest when none is set', () => {
    renderControls()
    expect(screen.getByLabelText<HTMLSelectElement>(T.sortLabel).value).toBe('nearest')
    expect(screen.getByLabelText<HTMLInputElement>(T.priceMaxLabel).value).toBe('')
  })

  it('emits the chosen sort', () => {
    const { onSortChange } = renderControls()
    fireEvent.change(screen.getByLabelText(T.sortLabel), { target: { value: 'priceAsc' } })
    expect(onSortChange).toHaveBeenCalledWith('priceAsc')
  })

  it('emits a positive price cap, and undefined when cleared', () => {
    const { onPriceMaxChange } = renderControls({ priceMax: 5000 })
    const input = screen.getByLabelText(T.priceMaxLabel)
    fireEvent.change(input, { target: { value: '9000' } })
    expect(onPriceMaxChange).toHaveBeenCalledWith(9000)
    fireEvent.change(input, { target: { value: '' } })
    expect(onPriceMaxChange).toHaveBeenLastCalledWith(undefined)
  })
})
