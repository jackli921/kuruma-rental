import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import { RatingBadge } from './RatingBadge'

function renderBadge(entry: Parameters<typeof RatingBadge>[0]['entry']) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <RatingBadge entry={entry} />
    </IntlProvider>,
  )
}

describe('RatingBadge (#1085 slice 5)', () => {
  it('undefined → renders the loading skeleton (no aria text, no rating glyph)', () => {
    renderBadge(undefined)
    // Skeleton is decorative (no semantic role), pinned by data-testid so a
    // refactor of the bar's class can't make this test pass on a visible text node.
    const skeleton = screen.getByTestId('rating-badge-skeleton')
    expect(skeleton.getAttribute('aria-hidden')).toBe('true')
    // Loading must NOT show the no-reviews copy — that's the no-data state, not in-flight.
    expect(screen.queryByText(/no reviews/i)).toBeNull()
    expect(skeleton.textContent).toBe('')
  })

  it('null → renders the "No reviews yet" copy with a matching aria-label', () => {
    renderBadge(null)
    const node = screen.getByLabelText('No reviews yet')
    expect(node.textContent).toBe('No reviews yet')
    // Skeleton must NOT be present — null is distinct from loading.
    expect(screen.queryByTestId('rating-badge-skeleton')).toBeNull()
  })

  it('{avg,count} → renders the ★ avg (count) glyph + the explicit a11y label', () => {
    const { container } = renderBadge({ avg: 4.5, count: 12 })
    // The visible label uses the i18n template `★ {avg} ({count})`. We pin the
    // EXACT text so a regression to (12 reviews) or omitting the glyph fails.
    const visible = screen.getByText('★ 4.5 (12)')
    expect(visible.tagName).toBe('SPAN')
    // Screen readers get the spelled-out form; the visual star is decorative.
    const aria = screen.getByLabelText('4.5 stars, 12 reviews')
    // Same node carries both — a regression that splits them into two elements fails.
    expect(aria).toBe(visible)
    // Sanity: nothing extra rendered (only the badge span).
    expect(container.querySelectorAll('span').length).toBe(1)
  })
})
