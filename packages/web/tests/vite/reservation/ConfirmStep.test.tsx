import { ConfirmStep } from '@/vite/reservation/ConfirmStep'
import type { ReservationAddOn } from '@/vite/reservation/api'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const addOns: ReservationAddOn[] = [
  { id: 'a1', name: 'Baby seat', description: null, priceJpy: 2000 },
]

function renderStep(overrides: Partial<Parameters<typeof ConfirmStep>[0]> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <ConfirmStep
        estimate={{ baseJpy: 16000, insuranceJpy: 3000, totalJpy: 21000 }}
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
      estimate: { baseJpy: 16000, insuranceJpy: 0, totalJpy: 18000 },
    })
    expect(screen.queryByText('Insurance')).toBeNull()
    expect(screen.queryByText('Full coverage')).toBeNull()
  })

  it('lists each selected add-on as its own priced line, not a collapsed subtotal', () => {
    renderStep({
      selectedAddOns: [
        { id: 'a1', name: 'Baby seat', description: null, priceJpy: 2000 },
        { id: 'a2', name: 'GPS unit', description: null, priceJpy: 4500 },
      ],
    })
    expect(screen.getByText('Baby seat')).toBeInTheDocument()
    expect(screen.getByText('￥2,000')).toBeInTheDocument()
    expect(screen.getByText('GPS unit')).toBeInTheDocument()
    expect(screen.getByText('￥4,500')).toBeInTheDocument()
    // The old "Extras" group header + single subtotal is gone — each add-on
    // now stands on its own line with its own price (#963).
    expect(screen.queryByText('Extras')).toBeNull()
  })

  it('shows the estimated grand total', () => {
    renderStep()
    expect(screen.getByText('Estimated total')).toBeInTheDocument()
    expect(screen.getByText('￥21,000')).toBeInTheDocument()
  })

  // #868 self-cancellation ships behind a feature flag (OFF for the beta demo).
  // The policy schedule is part of that flow, so the checkout must not advertise a
  // self-cancel tier table it then hides post-booking (#937 follow-up).
  describe('cancellation policy (feature flag)', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('hides the cancellation policy when the feature flag is OFF (beta demo)', () => {
      vi.stubEnv('VITE_FEATURE_CANCELLATION', 'false')
      renderStep()
      expect(screen.queryByRole('heading', { name: 'Cancellation policy' })).toBeNull()
    })

    it('shows the cancellation policy when the feature flag is ON', () => {
      vi.stubEnv('VITE_FEATURE_CANCELLATION', 'true')
      renderStep()
      expect(screen.getByRole('heading', { name: 'Cancellation policy' })).toBeInTheDocument()
    })
  })
})
