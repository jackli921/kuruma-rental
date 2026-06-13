import { ConfirmStep } from '@/vite/reservation/ConfirmStep'
import type { ReservationAddOn } from '@/vite/reservation/api'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

const addOns: ReservationAddOn[] = [
  { id: 'a1', name: 'Baby seat', description: null, priceJpy: 2000 },
]

function renderStep(overrides: Partial<Parameters<typeof ConfirmStep>[0]> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <ConfirmStep
        estimate={{ baseJpy: 16000, insuranceJpy: 3000, addOnsJpy: 2000, totalJpy: 21000 }}
        selectedAddOns={addOns}
        insuranceName="Full coverage"
        pickupAt={new Date('2026-12-01T10:00:00Z')}
        {...overrides}
      />
    </IntlProvider>,
  )
}

describe('ConfirmStep', () => {
  it('shows the base car-rental price', () => {
    renderStep()
    expect(screen.getByText('Car rental')).toBeInTheDocument()
    expect(screen.getByText('￥16,000')).toBeInTheDocument()
  })

  it('shows the insurance line with its name and price when coverage is selected', () => {
    renderStep()
    expect(screen.getByText('Insurance')).toBeInTheDocument()
    expect(screen.getByText('Full coverage')).toBeInTheDocument()
    expect(screen.getByText('￥3,000')).toBeInTheDocument()
  })

  it('omits the insurance line when no coverage is selected', () => {
    renderStep({
      insuranceName: null,
      estimate: { baseJpy: 16000, insuranceJpy: 0, addOnsJpy: 2000, totalJpy: 18000 },
    })
    expect(screen.queryByText('Insurance')).toBeNull()
    expect(screen.queryByText('Full coverage')).toBeNull()
  })

  it('lists the selected add-ons and their subtotal', () => {
    renderStep()
    expect(screen.getByText('Extras')).toBeInTheDocument()
    expect(screen.getByText('Baby seat')).toBeInTheDocument()
    expect(screen.getByText('￥2,000')).toBeInTheDocument()
  })

  it('shows the estimated grand total', () => {
    renderStep()
    expect(screen.getByText('Estimated total')).toBeInTheDocument()
    expect(screen.getByText('￥21,000')).toBeInTheDocument()
  })
})
