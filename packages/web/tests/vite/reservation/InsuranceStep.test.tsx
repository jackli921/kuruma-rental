import { InsuranceStep } from '@/vite/reservation/InsuranceStep'
import type { ReservationInsuranceOption } from '@/vite/reservation/api'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const options: ReservationInsuranceOption[] = [
  {
    id: 'i1',
    name: 'Full coverage',
    description: 'Comprehensive',
    dailyPriceJpy: 1500,
    deductibleJpy: 0,
  },
  { id: 'i2', name: 'Basic', description: null, dailyPriceJpy: 800, deductibleJpy: 50000 },
]

function renderStep(overrides: Partial<Parameters<typeof InsuranceStep>[0]> = {}) {
  const onSelect = vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <InsuranceStep options={options} selectedId={null} onSelect={onSelect} {...overrides} />
    </IntlProvider>,
  )
  return { onSelect }
}

describe('InsuranceStep', () => {
  it('selects "No insurance" by default (coverage is optional)', () => {
    renderStep()
    expect(screen.getByRole('radio', { name: /No insurance/ })).toBeChecked()
  })

  it('renders each option with its per-day price and deductible', () => {
    renderStep()
    expect(screen.getByText('Full coverage')).toBeInTheDocument()
    expect(screen.getByText('￥1,500 / day')).toBeInTheDocument()
    expect(screen.getByText('No deductible')).toBeInTheDocument() // i1: deductible 0
    expect(screen.getByText('Deductible ￥50,000')).toBeInTheDocument() // i2
  })

  it('calls onSelect with the option id when an option is chosen', () => {
    const { onSelect } = renderStep()
    fireEvent.click(screen.getByRole('radio', { name: /Full coverage/ }))
    expect(onSelect).toHaveBeenCalledWith('i1')
  })

  it('calls onSelect with null when "No insurance" is chosen', () => {
    const { onSelect } = renderStep({ selectedId: 'i1' })
    fireEvent.click(screen.getByRole('radio', { name: /No insurance/ }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('shows the empty state when the store offers no coverage', () => {
    renderStep({ options: [] })
    expect(
      screen.getByText('No insurance options are available at this store.'),
    ).toBeInTheDocument()
  })
})
