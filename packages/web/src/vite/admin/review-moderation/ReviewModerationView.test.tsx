import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { ReviewModerationView } from './ReviewModerationView'
import type { ReportedReviewDto } from './api'
import { hideReview } from './api'

// The Hide button reads the CSRF token from the session and POSTs via hideReview;
// both are stubbed so the test asserts the wiring, not real I/O.
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { csrfToken: 'csrf_1' } }),
}))
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, hideReview: vi.fn() }
})

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

function renderView(reported: ReportedReviewDto[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <IntlProvider locale="en" messages={en}>
        <ReviewModerationView reported={reported} />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('ReviewModerationView', () => {
  afterEach(() => vi.mocked(hideReview).mockReset())

  it('shows an empty state when nothing is reported', () => {
    renderView([])
    expect(screen.getByText(en.admin.reviewModeration.empty)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.reviewModeration.hide })).toBeNull()
  })

  it('renders a reported review with its comment, reasons, and report count', () => {
    renderView([VISIBLE_ENTRY])
    expect(screen.getByText('terrible and abusive')).toBeInTheDocument()
    expect(screen.getByText('abusive language')).toBeInTheDocument()
    expect(screen.getByText('spam')).toBeInTheDocument()
    // ICU plural: "2 reports"
    expect(screen.getByText('2 reports')).toBeInTheDocument()
  })

  it('hides a review with the session CSRF token when Hide is clicked', async () => {
    vi.mocked(hideReview).mockResolvedValue(undefined)
    renderView([VISIBLE_ENTRY])

    fireEvent.click(screen.getByRole('button', { name: en.admin.reviewModeration.hide }))

    await waitFor(() =>
      expect(vi.mocked(hideReview).mock.calls[0]?.[0]).toEqual({ id: 'r1', csrfToken: 'csrf_1' }),
    )
  })

  it('shows a Hidden badge and no Hide button for an already-hidden review', () => {
    renderView([
      { ...VISIBLE_ENTRY, review: { ...VISIBLE_ENTRY.review, moderationStatus: 'HIDDEN' } },
    ])
    expect(screen.getByText(en.admin.reviewModeration.hidden)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.admin.reviewModeration.hide })).toBeNull()
  })
})
