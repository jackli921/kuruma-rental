import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { ReviewModerationView } from './ReviewModerationView'
import type { ModerationFilter, ReportedReviewDto } from './api'
import { hideReview } from './api'

// The Hide button reads the CSRF token from the session and POSTs via hideReview;
// both are stubbed so the test asserts the wiring, not real I/O. Pagination + the
// filter are props the route owns, so they are asserted via spy callbacks.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'csrf_1' } }),
}))
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, hideReview: vi.fn() }
})

const t = en.admin.reviewModeration

const VISIBLE_ENTRY: ReportedReviewDto = {
  review: {
    id: 'r1',
    subject: 'OPERATOR',
    authorRole: 'RENTER',
    overall: 1,
    comment: 'terrible and abusive',
    moderationStatus: 'VISIBLE',
    submittedAt: '2026-06-01T00:00:00.000Z',
  },
  reportCount: 2,
  reasons: ['abusive language', 'spam'],
}

interface Overrides {
  items?: ReportedReviewDto[]
  status?: ModerationFilter
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
}

function renderView(overrides: Overrides = {}) {
  const onStatusChange = vi.fn()
  const onLoadMore = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <ReviewModerationView
          items={overrides.items ?? []}
          status={overrides.status ?? 'VISIBLE'}
          onStatusChange={onStatusChange}
          hasNextPage={overrides.hasNextPage ?? false}
          isFetchingNextPage={overrides.isFetchingNextPage ?? false}
          onLoadMore={onLoadMore}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onStatusChange, onLoadMore }
}

describe('ReviewModerationView', () => {
  afterEach(() => vi.mocked(hideReview).mockReset())

  it('shows an empty state when nothing is reported', () => {
    renderView({ items: [] })
    expect(screen.getByText(t.empty)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.hide })).toBeNull()
  })

  it('renders a reported review with its comment, reasons, and report count', () => {
    renderView({ items: [VISIBLE_ENTRY] })
    expect(screen.getByText('terrible and abusive')).toBeInTheDocument()
    expect(screen.getByText('abusive language')).toBeInTheDocument()
    expect(screen.getByText('spam')).toBeInTheDocument()
    // ICU plural: "2 reports"
    expect(screen.getByText('2 reports')).toBeInTheDocument()
  })

  it('hides a review with the session CSRF token when Hide is clicked', async () => {
    vi.mocked(hideReview).mockResolvedValue(undefined)
    renderView({ items: [VISIBLE_ENTRY] })

    fireEvent.click(screen.getByRole('button', { name: t.hide }))

    await waitFor(() =>
      expect(vi.mocked(hideReview).mock.calls[0]?.[0]).toEqual({ id: 'r1', csrfToken: 'csrf_1' }),
    )
  })

  it('shows a Hidden badge and no Hide button for an already-hidden review', () => {
    renderView({
      items: [
        { ...VISIBLE_ENTRY, review: { ...VISIBLE_ENTRY.review, moderationStatus: 'HIDDEN' } },
      ],
      status: 'HIDDEN',
    })
    expect(screen.getByText(t.hidden)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.hide })).toBeNull()
  })

  it('marks the active status tab and switches partition on the other tab (#1451)', () => {
    const { onStatusChange } = renderView({ items: [VISIBLE_ENTRY], status: 'VISIBLE' })
    expect(screen.getByRole('button', { name: t.filterUnactioned })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: t.filterResolved })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    fireEvent.click(screen.getByRole('button', { name: t.filterResolved }))
    expect(onStatusChange).toHaveBeenCalledWith('HIDDEN')
  })

  it('shows Load more only when another page exists, and requests it on click (#1451)', () => {
    const { onLoadMore } = renderView({ items: [VISIBLE_ENTRY], hasNextPage: true })
    fireEvent.click(screen.getByRole('button', { name: t.loadMore }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('hides Load more when the queue is exhausted', () => {
    renderView({ items: [VISIBLE_ENTRY], hasNextPage: false })
    expect(screen.queryByRole('button', { name: t.loadMore })).toBeNull()
  })
})
