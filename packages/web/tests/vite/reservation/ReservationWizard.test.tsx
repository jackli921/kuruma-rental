import { ReservationWizard } from '@/vite/reservation/ReservationWizard'
import type { ReservationAddOn, ReservationInsuranceOption } from '@/vite/reservation/api'
import type { AvailableVehicleData } from '@/vite/storefronts/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// The wizard renders the live submit step (PaymentStep, which reads the session +
// router) and a step-1 back-to-listing TanStack Link (#962). Stub useNavigate and
// Link: the latter as a plain anchor exposing its target + carried search params
// (mirrors SearchResultRow.test) so the wizard renders without a RouterProvider.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params?: { locale?: string; locationId?: string }
    search?: Record<string, unknown>
    children: ReactNode
  }) => (
    <a
      href={to}
      data-to={to}
      data-locale={params?.locale}
      data-location={params?.locationId}
      data-search={JSON.stringify(search ?? {})}
      {...rest}
    >
      {children}
    </a>
  ),
}))
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { user: { id: 'r1', role: 'RENTER' }, csrfToken: 'csrf-1' } }),
}))

const jst = (value: string): Date => new Date(`${value}:00+09:00`)

const vehicle: AvailableVehicleData = {
  id: 'v1',
  name: 'Toyota Aqua',
  make: 'Toyota',
  model: 'Aqua',
  year: 2024,
  seats: 5,
  transmission: 'AUTO',
  acrissCode: null,
  classLabel: 'Compact',
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  photos: [],
}
const addOns: ReservationAddOn[] = [
  { id: 'a1', name: 'Baby seat', description: null, priceJpy: 2000 },
]
const insuranceOptions: ReservationInsuranceOption[] = [
  { id: 'i1', name: 'Full coverage', description: null, dailyPriceJpy: 1500, deductibleJpy: 0 },
]

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <ReservationWizard
          locale="en"
          vehicle={vehicle}
          locationId="loc1"
          addOns={addOns}
          insuranceOptions={insuranceOptions}
          from={jst('2026-07-01T10:00')}
          to={jst('2026-07-03T10:00')} // exactly 2 days
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

describe('ReservationWizard', () => {
  it('starts on the dates step naming the chosen vehicle', () => {
    renderWizard()
    expect(screen.getByText('Your rental dates')).toBeInTheDocument()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
  })

  it('links the first step back to the storefront listing, carrying the date range (#962)', () => {
    renderWizard()
    const back = screen.getByRole('link', { name: 'Back to listing' })
    expect(back).toHaveAttribute('data-to', '/$locale/storefronts/$locationId')
    expect(back).toHaveAttribute('data-locale', 'en')
    expect(back).toHaveAttribute('data-location', 'loc1')
    // from/to are Date objects, serialized to JST datetime-local so the storefront
    // route's parseSearchRange accepts them (a raw Date becomes an ISO instant that
    // would redirect to /search).
    const search = JSON.parse(back.getAttribute('data-search') ?? '{}')
    expect(search).toMatchObject({ from: '2026-07-01T10:00', to: '2026-07-03T10:00' })
  })

  it('walks dates -> add-ons -> insurance -> confirm, accumulating the running total', async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Add optional extras')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Baby seat/ }))

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Choose your coverage')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Full coverage/ }))

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Review your booking')).toBeInTheDocument()
    // base 8000×2 = 16000, insurance 1500×2 = 3000, add-on 2000 -> 21000
    expect(screen.getByText('Estimated total')).toBeInTheDocument()
    expect(screen.getByText('￥21,000')).toBeInTheDocument()
  })

  it('confirms without insurance when the renter declines coverage', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // add-ons
    await user.click(screen.getByRole('button', { name: 'Continue' })) // insurance (default: none)
    await user.click(screen.getByRole('button', { name: 'Continue' })) // confirm
    // base only: 16000 shows on both the car-rental line and the total (nothing added)
    expect(screen.getAllByText('￥16,000')).toHaveLength(2)
    expect(screen.getByText('Estimated total')).toBeInTheDocument()
  })

  it('reaches the instant-book submit step with a live Reserve action', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // add-ons
    await user.click(screen.getByRole('button', { name: 'Continue' })) // insurance
    await user.click(screen.getByRole('button', { name: 'Continue' })) // confirm
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))
    expect(screen.getByText(/You pay at pickup, not online/)).toBeInTheDocument()
    // Reserve is gated on the liability-disclaimer consent (#613): live only after
    // the renter acknowledges in-person verification at pickup.
    expect(screen.getByRole('button', { name: 'Reserve now' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Reserve now' })).toBeEnabled()
  })

  it('lets the renter step back to a previous step', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // add-ons
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Your rental dates')).toBeInTheDocument()
  })
})
