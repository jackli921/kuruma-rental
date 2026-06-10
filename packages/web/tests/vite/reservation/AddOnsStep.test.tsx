import { AddOnsStep } from '@/vite/reservation/AddOnsStep'
import type { ReservationAddOn } from '@/vite/reservation/api'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

const addOns: ReservationAddOn[] = [
  { id: 'a1', name: 'Baby seat', description: 'Rear-facing', priceJpy: 2000 },
  { id: 'a2', name: 'ETC card', description: null, priceJpy: 500 },
]

function renderStep(overrides: Partial<Parameters<typeof AddOnsStep>[0]> = {}) {
  const onToggle = vi.fn()
  render(
    <IntlProvider locale="en" messages={en}>
      <AddOnsStep addOns={addOns} selectedIds={[]} onToggle={onToggle} {...overrides} />
    </IntlProvider>,
  )
  return { onToggle }
}

describe('AddOnsStep', () => {
  it('lists each add-on with its name and flat per-rental price', () => {
    renderStep()
    expect(screen.getByText('Baby seat')).toBeInTheDocument()
    expect(screen.getByText('￥2,000 per rental')).toBeInTheDocument()
    expect(screen.getByText('ETC card')).toBeInTheDocument()
    expect(screen.getByText('￥500 per rental')).toBeInTheDocument()
  })

  it('reflects the currently selected add-ons as checked', () => {
    renderStep({ selectedIds: ['a1'] })
    expect(screen.getByRole('checkbox', { name: /Baby seat/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /ETC card/ })).not.toBeChecked()
  })

  it('calls onToggle with the add-on id when its checkbox is clicked', () => {
    const { onToggle } = renderStep()
    fireEvent.click(screen.getByRole('checkbox', { name: /Baby seat/ }))
    expect(onToggle).toHaveBeenCalledWith('a1')
  })

  it('shows the empty state when the store offers no add-ons', () => {
    renderStep({ addOns: [] })
    expect(screen.getByText('No extras are available at this store.')).toBeInTheDocument()
  })
})
