import { ReviewList } from '@/vite/reviews/ReviewList'
import type { PublicReviewDto } from '@/vite/reviews/api'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const sample: PublicReviewDto[] = [
  {
    id: 'r1',
    overall: 5,
    subRatings: { cleanliness: 4 },
    comment: 'Spotless car',
    publishedAt: '2026-06-02T03:00:00.000Z',
  },
]

function renderList(reviews: PublicReviewDto[]) {
  return render(
    <IntlProvider locale="en" messages={en} timeZone="Asia/Tokyo">
      <ReviewList reviews={reviews} />
    </IntlProvider>,
  )
}

afterEach(() => vi.unstubAllEnvs())

describe('ReviewList', () => {
  it('renders nothing when the REVIEWS flag is off (default, no stub)', () => {
    const { container } = renderList(sample)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the comment and an overall star label when the flag is on', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    renderList(sample)
    expect(screen.getByText('Spotless car')).toBeInTheDocument()
    // StarDisplay renders role="img" with aria-label = reviews.list.overallAria.
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeInTheDocument()
    // Sub-rating label (reviews.form.dimension.cleanliness) and value (reviews.list.dimensionValue).
    expect(screen.getByText('Cleanliness')).toBeInTheDocument()
    expect(screen.getByText('4/5')).toBeInTheDocument()
  })

  it('shows the empty state when there are no reviews', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    renderList([])
    expect(screen.getByText('No reviews yet')).toBeInTheDocument()
  })
})
