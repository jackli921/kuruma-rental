import { ReservationWizard } from '@/vite/reservation/ReservationWizard'
import type { ReservationAddOn, ReservationInsuranceOption } from '@/vite/reservation/api'
import type { AvailableVehicleData } from '@/vite/storefronts/api'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

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
  return render(
    <IntlProvider locale="en" messages={en}>
      <ReservationWizard
        locale="en"
        vehicle={vehicle}
        addOns={addOns}
        insuranceOptions={insuranceOptions}
        from={jst('2026-07-01T10:00')}
        to={jst('2026-07-03T10:00')} // exactly 2 days
      />
    </IntlProvider>,
  )
}

describe('ReservationWizard', () => {
  it('starts on the dates step naming the chosen vehicle', () => {
    renderWizard()
    expect(screen.getByText('Your rental dates')).toBeInTheDocument()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
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

  it('reaches the payment stub with the pay action disabled (no live submit)', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // add-ons
    await user.click(screen.getByRole('button', { name: 'Continue' })) // insurance
    await user.click(screen.getByRole('button', { name: 'Continue' })) // confirm
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }))
    expect(
      screen.getByText('Online payment is coming soon. Your booking is not confirmed yet.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay and confirm' })).toBeDisabled()
  })

  it('lets the renter step back to a previous step', async () => {
    const user = userEvent.setup()
    renderWizard()
    await user.click(screen.getByRole('button', { name: 'Continue' })) // add-ons
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Your rental dates')).toBeInTheDocument()
  })
})
