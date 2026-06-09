import { DateRangeStep } from '@/vite/reservation/DateRangeStep'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

const jst = (value: string): Date => new Date(`${value}:00+09:00`)

function renderStep(overrides: Partial<Parameters<typeof DateRangeStep>[0]> = {}) {
  render(
    <IntlProvider locale="en" messages={en}>
      <DateRangeStep
        locale="en"
        vehicleName="Toyota Aqua"
        from={jst('2026-07-01T10:00')}
        to={jst('2026-07-03T10:00')}
        {...overrides}
      />
    </IntlProvider>,
  )
}

describe('DateRangeStep', () => {
  it('names the vehicle being booked', () => {
    renderStep()
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
  })

  it('shows the rental duration in whole days', () => {
    renderStep()
    expect(screen.getByText('2 days')).toBeInTheDocument()
  })

  it('renders the singular day form for a same-day-plus-one rental', () => {
    renderStep({ to: jst('2026-07-01T20:00') }) // 10h -> 1 day
    expect(screen.getByText('1 day')).toBeInTheDocument()
  })

  it('labels the pickup and return times', () => {
    renderStep()
    expect(screen.getByText('Pickup')).toBeInTheDocument()
    expect(screen.getByText('Return')).toBeInTheDocument()
  })
})
