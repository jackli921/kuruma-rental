import { ReviewPrompt } from '@/vite/reviews/ReviewPrompt'
import type { Session } from '@/vite/session'
import { sessionQueryOptions } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const SESSION: Session = {
  user: { id: 'renter-1', role: 'RENTER' },
  csrfToken: 'csrf-xyz',
}

function renderPrompt(reviewedSubjects: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(sessionQueryOptions().queryKey, SESSION)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
  return render(
    <ReviewPrompt bookingId="bk-1" bookingCode="RVEW1234" reviewedSubjects={reviewedSubjects} />,
    { wrapper },
  )
}

describe('ReviewPrompt', () => {
  // Reviews ships OFF for the beta MVP; the post-trip prompt only shows where the flag is on.
  beforeEach(() => vi.stubEnv('VITE_FEATURE_REVIEWS', 'true'))
  afterEach(() => vi.unstubAllEnvs())

  it('renders nothing when the reviews feature is gated off (#1083-1086)', () => {
    vi.stubEnv('VITE_FEATURE_REVIEWS', undefined)
    renderPrompt([])
    expect(screen.queryByRole('button', { name: en.reviews.prompt.cta })).not.toBeInTheDocument()
  })

  it('shows the review CTA when the renter has reviewed neither subject', () => {
    renderPrompt([])
    expect(screen.getByRole('button', { name: en.reviews.prompt.cta })).toBeInTheDocument()
  })

  it('shows the CTA when only one of the two subjects is still pending', () => {
    renderPrompt(['OPERATOR'])
    expect(screen.getByRole('button', { name: en.reviews.prompt.cta })).toBeInTheDocument()
  })

  it('renders nothing once both subjects have been reviewed', () => {
    renderPrompt(['OPERATOR', 'VEHICLE'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
