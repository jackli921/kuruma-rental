import { FeatureFlagsProvider } from '@/vite/config'
import type { AvailableVehicleData } from '@/vite/storefronts/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Repo test pattern (AvailableVehicleCard): the summary bar's first-step "back to
// listing" affordance is a router <Link>, which needs no RouterProvider once mocked
// to a plain anchor. Only the dates step renders a Link, so this is all we need.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#link">{children}</a>,
}))

import { ReservationWizard } from './ReservationWizard'
import type { ReservationSubject } from './subject'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
})

const vehicle: AvailableVehicleData = {
  id: 'v1',
  classId: 'c1',
  name: 'Toyota Aqua',
  make: 'Toyota',
  model: 'Aqua',
  year: 2024,
  seats: 5,
  luggageCapacity: 2,
  luggageSize: 'MEDIUM',
  transmission: 'AUTO',
  acrissCode: 'CDMR',
  classLabel: 'Compact',
  dailyRateJpy: 8000,
  hourlyRateJpy: 1200,
  photos: ['veh-front.jpg'],
}
const specificSubject: ReservationSubject = { kind: 'SPECIFIC', vehicle }
const comboSubject: ReservationSubject = {
  kind: 'CLASS_COMBO',
  offering: {
    kind: 'CLASS_COMBO',
    location: {
      locationId: 'loc1',
      operatorId: 'op1',
      operatorName: 'Osaka Cars',
      name: 'Namba Store',
      address: '1-1 Namba',
      latitude: null,
      longitude: null,
    },
    dailyRateJpy: 6000,
    hourlyRateJpy: null,
    classLabel: 'Economy',
    acrissCode: 'ECMR',
    seats: 4,
    photos: ['class-eco.jpg'],
    classId: 'class-eco',
    availableCount: 3,
  },
}

// A distinctive comment so its presence unambiguously proves the vehicle review
// list rendered data fetched from the vehicle endpoint (not the heading alone).
const REVIEW_COMMENT = 'Impeccable little kei car'
const reviewPage = {
  success: true,
  data: {
    reviews: [
      {
        id: 'rev1',
        overall: 5,
        subRatings: {},
        comment: REVIEW_COMMENT,
        publishedAt: '2026-06-02T03:00:00.000Z',
        reviewerFirstName: 'Jack',
      },
    ],
    nextCursor: null,
  },
}

function renderWizard(subject: ReservationSubject, reviewsEnabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['feature-flags'], { REVIEWS: reviewsEnabled })
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <FeatureFlagsProvider>
          <ReservationWizard
            locale="en"
            subject={subject}
            locationId="loc1"
            operatorId="op1"
            addOns={[]}
            insuranceOptions={[]}
            from={new Date('2026-08-01T10:00:00+09:00')}
            to={new Date('2026-08-03T10:00:00+09:00')}
          />
        </FeatureFlagsProvider>
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('ReservationWizard vehicle reviews (#1448)', () => {
  it('renders the picked car reviews on the dates step and reads the VEHICLE endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reviewPage))
    renderWizard(specificSubject, true)

    expect(await screen.findByText(REVIEW_COMMENT)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/reviews/for/vehicles/v1')
  })

  it('never fetches or renders vehicle reviews for a CLASS_COMBO subject (operator assigns the car later)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reviewPage))
    renderWizard(comboSubject, true)

    // The class-combo has no concrete car, so there is nothing to review yet.
    await waitFor(() => expect(screen.getByText('Economy')).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(REVIEW_COMMENT)).toBeNull()
  })

  it('stays silent (no fetch, no list) when the REVIEWS flag is off', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reviewPage))
    renderWizard(specificSubject, false)

    await waitFor(() => expect(screen.getByText('Toyota Aqua')).toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(REVIEW_COMMENT)).toBeNull()
  })

  it('injects no empty reviews block when the picked car has no reviews yet', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { reviews: [], nextCursor: null } }),
    )
    renderWizard(specificSubject, true)

    // A concrete no-review anchor proves the empty query RESOLVED into the tree (so a
    // passing "absent" assertion can't be a render-timing false negative): the car name
    // from the dates step is always present once mounted.
    expect(await screen.findByText('Toyota Aqua')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/reviews/for/vehicles/v1'))
    // Let the resolved empty page flush through react-query's state update.
    await act(async () => {
      await Promise.resolve()
    })
    // A zero-review car must not drop a "No reviews yet" placeholder into the booking
    // flow — that empty state belongs on the storefront browse page, not mid-checkout.
    expect(screen.queryByText(en.reviews.list.empty)).toBeNull()
  })

  it('shows the reviews on the dates step only — advancing to extras hides them', async () => {
    fetchMock.mockResolvedValue(jsonResponse(reviewPage))
    renderWizard(specificSubject, true)

    expect(await screen.findByText(REVIEW_COMMENT)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: en.reservation.nav.continue }))
    expect(screen.queryByText(REVIEW_COMMENT)).toBeNull()
  })
})
