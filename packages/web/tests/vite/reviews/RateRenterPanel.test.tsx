import { RateRenterPanel } from '@/vite/reviews/RateRenterPanel'
import type { ReviewDto } from '@/vite/reviews/api'
import { reviewsForBookingQueryOptions } from '@/vite/reviews/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const p = en.reviews.operatorPanel
const BOOKING_ID = 'bk-1'

function renderPanel(reviews: ReviewDto[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  // Seed the reviews read so the panel decides hide-vs-show without a network round-trip.
  queryClient.setQueryData(reviewsForBookingQueryOptions(BOOKING_ID).queryKey, reviews)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  return render(
    <RateRenterPanel bookingId={BOOKING_ID} bookingCode="RVEW1234" csrfToken="csrf-xyz" />,
    { wrapper },
  )
}

function operatorReview(): ReviewDto {
  return {
    id: 'r-op',
    bookingId: BOOKING_ID,
    authorRole: 'OPERATOR',
    subject: 'RENTER',
    overall: 4,
    comment: null,
    publishedAt: null,
  }
}

function setStars(groupName: string, stars: number) {
  const radio = document.querySelector<HTMLInputElement>(
    `input[name="${groupName}"][aria-label="${stars} stars"]`,
  )
  if (!radio) throw new Error(`no star radio for ${groupName} = ${stars}`)
  fireEvent.click(radio)
}

describe('RateRenterPanel', () => {
  beforeEach(() => {
    // Reviews ships OFF for the beta MVP; the operator panel only renders where the flag is on.
    vi.stubEnv('VITE_FEATURE_REVIEWS', 'true')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 201,
        json: async () => ({
          success: true,
          data: {
            review: {
              id: 'r1',
              bookingId: BOOKING_ID,
              authorRole: 'OPERATOR',
              subject: 'RENTER',
              overall: 5,
              comment: null,
              publishedAt: null,
            },
          },
        }),
      })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('renders nothing when the reviews feature is gated off (#1083-1086)', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', undefined)
    renderPanel([])
    // Neither the rate CTA nor the "reviewed" line surfaces while gated off.
    expect(screen.queryByRole('button', { name: p.cta })).not.toBeInTheDocument()
    expect(screen.queryByText(p.reviewed)).not.toBeInTheDocument()
  })

  it('shows the rate CTA when the operator has not yet reviewed the renter', () => {
    renderPanel([])
    expect(screen.getByRole('button', { name: p.cta })).toBeInTheDocument()
  })

  it('shows the reviewed state (no CTA) once any staff member of the operator has reviewed', () => {
    renderPanel([operatorReview()])
    expect(screen.getByText(p.reviewed)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: p.cta })).not.toBeInTheDocument()
  })

  it('posts a subject=RENTER review with the rated values + CSRF token', async () => {
    renderPanel([])
    fireEvent.click(screen.getByRole('button', { name: p.cta }))

    setStars('overall-renter', 5)
    setStars('dim-renter-ruleAdherence', 4)
    fireEvent.click(screen.getByRole('button', { name: p.submit }))

    // Two requests fire: the POST write, then the GET re-read invalidateQueries triggers.
    // Assert on the POST specifically so the re-read doesn't muddy the count.
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const isPost = (call: unknown): boolean =>
      (call as [string, { method?: string }])[1]?.method === 'POST'
    await waitFor(() => expect(fetchMock.mock.calls.filter(isPost)).toHaveLength(1))

    const [url, init] = fetchMock.mock.calls.find(isPost) as [
      string,
      { body: string; headers: Record<string, string> },
    ]
    expect(url).toContain('/reviews')
    expect(JSON.parse(init.body)).toEqual({
      bookingId: BOOKING_ID,
      subject: 'RENTER',
      overall: 5,
      subRatings: { ruleAdherence: 4 },
    })
    expect(init.headers['X-CSRF-Token']).toBe('csrf-xyz')
  })
})
