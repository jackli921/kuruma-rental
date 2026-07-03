import { createBooking } from '@/vite/bookings/api'
import { ReservationWizard } from '@/vite/reservation/ReservationWizard'
import type { ReservationAddOn, ReservationInsuranceOption } from '@/vite/reservation/api'
import type { ReservationSubject } from '@/vite/reservation/subject'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// #464 slice 3: the wizard books a class-combo subject (a CLASS, not a concrete
// car). Router + session are stubbed as in ReservationWizard.test; createBooking
// is mocked so the CLASS_COMBO submit body can be asserted (mutation-resistant:
// classId present AND requestedVehicleId absent).
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('@/vite/session', () => ({
  useSession: () => ({ data: { user: { id: 'r1', role: 'RENTER' }, csrfToken: 'csrf-1' } }),
}))
vi.mock('@/vite/bookings/api', () => ({
  createBooking: vi.fn(async () => ({ id: 'bk-1' })),
}))

const jst = (value: string): Date => new Date(`${value}:00+09:00`)

const offering = {
  kind: 'CLASS_COMBO' as const,
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
}
const comboSubject: ReservationSubject = { kind: 'CLASS_COMBO', offering }

const addOns: ReservationAddOn[] = []
const insuranceOptions: ReservationInsuranceOption[] = []

function renderWizard(subject: ReservationSubject = comboSubject) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        <ReservationWizard
          locale="en"
          subject={subject}
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

describe('ReservationWizard — class-combo subject (#464)', () => {
  it('names the class (not a car) on the dates step', () => {
    renderWizard()
    expect(screen.getByText('Economy')).toBeInTheDocument()
  })

  it('prices off the class rate plan (￥6,000/day × 2), not a vehicle rate', () => {
    renderWizard()
    // 6000 × 2 days = 12,000. A vehicle-rate leak (8,000) would read ￥16,000.
    expect(screen.getByText('￥12,000')).toBeInTheDocument()
  })

  it('shows the class-assignment note on the confirm step', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // add-ons
    await user.click(screen.getByRole('button', { name: 'Continue' })) // insurance
    await user.click(screen.getByRole('button', { name: 'Continue' })) // confirm
    expect(screen.getByText(/assigned before pickup/i)).toBeInTheDocument()
  })

  it('submits a CLASS_COMBO booking body — classId present, requestedVehicleId absent', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // add-ons
    await user.click(screen.getByRole('button', { name: 'Continue' })) // insurance
    await user.click(screen.getByRole('button', { name: 'Continue' })) // confirm
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Reserve now' }))

    await waitFor(() => expect(vi.mocked(createBooking)).toHaveBeenCalledTimes(1))
    const [body, token] = vi.mocked(createBooking).mock.calls[0]!
    expect(token).toBe('csrf-1')
    expect(body).toMatchObject({
      fulfillmentMode: 'CLASS_COMBO',
      classId: 'class-eco',
      pickupLocationId: 'loc1',
      dropoffLocationId: 'loc1',
    })
    expect(body).not.toHaveProperty('requestedVehicleId')
  })
})
