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
    luggageCapacity: null,
    luggageSize: null,
    photos: [],
    ...overrides,
  }
}

function renderCard(vehicle: AvailableVehicleData) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <AvailableVehicleCard vehicle={vehicle} />
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

  // #457: effective luggage (vehicle override resolved against the class default).
  it('shows the resolved luggage count and size when both are present', () => {
    renderCard(makeVehicle({ luggageCapacity: 4, luggageSize: 'LARGE' }))
    expect(screen.getByText('4 bags')).toBeInTheDocument()
    expect(screen.getByText(/Large/)).toBeInTheDocument()
  })

  it('shows the count alone when the resolved size is null', () => {
    renderCard(makeVehicle({ luggageCapacity: 4, luggageSize: null }))
    expect(screen.getByText('4 bags')).toBeInTheDocument()
    expect(screen.queryByText(/Large/)).toBeNull()
  })

  it('renders no luggage line when capacity is unknown (classless, no override)', () => {
    renderCard(makeVehicle({ luggageCapacity: null, luggageSize: null }))
    expect(screen.queryByText(/bags/)).toBeNull()
  })
})
