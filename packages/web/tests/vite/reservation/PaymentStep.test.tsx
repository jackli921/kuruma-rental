import { PaymentStep } from '@/vite/reservation/PaymentStep'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

function renderStep(overrides: Partial<Parameters<typeof PaymentStep>[0]> = {}) {
  const onBack = vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <PaymentStep onBack={onBack} {...overrides} />
    </IntlProvider>,
  )
  return { onBack }
}

describe('PaymentStep', () => {
  it('explains that online payment is not yet available', () => {
    renderStep()
    expect(
      screen.getByText('Online payment is coming soon. Your booking is not confirmed yet.'),
    ).toBeInTheDocument()
  })

  it('renders the pay action disabled (held for #461)', () => {
    renderStep()
    expect(screen.getByRole('button', { name: 'Pay and confirm' })).toBeDisabled()
  })

  it('calls onBack when the back button is pressed', () => {
    const { onBack } = renderStep()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
