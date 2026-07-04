import { ReviewList } from '@/vite/reviews/ReviewList'
import type { PublicReviewDto } from '@/vite/reviews/api'
import { fireEvent, render, screen } from '@testing-library/react'
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
    reviewerFirstName: null,
  },
]

type PaginationProps = {
  hasMore?: boolean
  onLoadMore?: () => void
  isLoadingMore?: boolean
}

function renderList(reviews: PublicReviewDto[], pagination: PaginationProps = {}) {
  return render(
    <IntlProvider locale="en" messages={en} timeZone="Asia/Tokyo">
      <ReviewList reviews={reviews} {...pagination} />
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

  // #1450 reviewer first-name projection.
  it("shows the reviewer's first name when the server provides one", () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    renderList([{ ...sample[0]!, reviewerFirstName: 'Jack' }])
    expect(screen.getByText('Jack')).toBeInTheDocument()
    // The anonymous fallback must NOT also render for a named reviewer.
    expect(screen.queryByText('Verified renter')).not.toBeInTheDocument()
  })

  it('falls back to the anonymous label when reviewerFirstName is null', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    renderList(sample) // sample carries reviewerFirstName: null
    expect(screen.getByText('Verified renter')).toBeInTheDocument()
    expect(screen.queryByText('Jack')).not.toBeInTheDocument()
  })

  // #1449 "load more" affordance.
  it('renders no load-more button when hasMore is false', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    renderList(sample, { hasMore: false, onLoadMore: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Show more reviews' })).not.toBeInTheDocument()
  })

  it('renders a load-more button when hasMore, and calls onLoadMore on click', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    const onLoadMore = vi.fn()
    renderList(sample, { hasMore: true, onLoadMore })
    const button = screen.getByRole('button', { name: 'Show more reviews' })
    fireEvent.click(button)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('disables the button and shows a loading label while fetching the next page', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    const onLoadMore = vi.fn()
    renderList(sample, { hasMore: true, onLoadMore, isLoadingMore: true })
    const button = screen.getByRole('button', { name: 'Loading…' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onLoadMore).not.toHaveBeenCalled()
  })
})
