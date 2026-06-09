import { AvailableVehicleCard } from '@/vite/storefronts/AvailableVehicleCard'
import type { AvailableVehicleData } from '@/vite/storefronts/api'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function makeVehicle(overrides: Partial<AvailableVehicleData> = {}): AvailableVehicleData {
  return {
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
    ...overrides,
  }
}

function renderCard(vehicle: AvailableVehicleData) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <AvailableVehicleCard vehicle={vehicle} locationId="loc-1" from="f" to="t" />
    </IntlProvider>,
  )
}

describe('AvailableVehicleCard', () => {
  it('renders the vehicle name, seats, transmission, and daily price', () => {
    renderCard(makeVehicle())
    expect(screen.getByText('Toyota Aqua')).toBeInTheDocument()
    expect(screen.getByText('5 seats')).toBeInTheDocument()
    expect(screen.getByText('Automatic')).toBeInTheDocument()
    expect(screen.getByText('From ¥8,000 / day')).toBeInTheDocument()
  })

  it('renders the booking CTA as an inert button while /bookings/new is deferred', () => {
    renderCard(makeVehicle())
    const book = screen.getByRole('button', { name: 'Book this car' })
    expect(book).toBeDisabled()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
