import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StarRating } from './StarRating'

function renderStars(over: Partial<Parameters<typeof StarRating>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <StarRating
      name="vehicle"
      label="Vehicle"
      value={0}
      onChange={onChange}
      starLabel={(n) => `${n} stars`}
      {...over}
    />,
  )
  return { onChange }
}

describe('StarRating', () => {
  it('renders a 5-radio group, each star an independently labelled option', () => {
    renderStars({ name: 'operator' })
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(5)
    expect(radios.map((r) => r.getAttribute('name'))).toEqual([
      'operator',
      'operator',
      'operator',
      'operator',
      'operator',
    ])
    expect(screen.getByRole('radio', { name: '3 stars' })).toBeInTheDocument()
  })

  it('reports the chosen rating and reflects the controlled value', () => {
    const { onChange } = renderStars({ value: 2 })
    // The 4th star is checked-through only when value says so; at value=2 exactly two are checked.
    expect((screen.getByRole('radio', { name: '2 stars' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }))
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('gives every star a coarse-pointer touch target so the row is tappable on a phone (#1301)', () => {
    // Regression pin: the interactive star hit-area must opt into the >=44px touch
    // floor on coarse pointers (the geometry itself is proven on the mobile Playwright
    // lane via the identically-patterned cancel radios). Each star's <label> owns the
    // tap area, so the coarse-pointer sizing must live there.
    renderStars()
    for (const radio of screen.getAllByRole('radio')) {
      const label = radio.closest('label')
      expect(label?.className).toMatch(/pointer-coarse:/)
    }
    // Sanity: the label is the tap target (the input is visually hidden).
    expect(
      within(screen.getAllByRole('radio')[0]!.closest('label')!).getByRole('radio'),
    ).toHaveClass('sr-only')
  })
})
