import { ClassDetailView } from '@/vite/vehicles/ClassDetailView'
import type { VehicleClassData } from '@/vite/vehicles/classes'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

function makeClass(overrides: Partial<VehicleClassData> = {}): VehicleClassData {
  return {
    id: 'c1',
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: null,
    sortOrder: 0,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderDetail(vc: VehicleClassData) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ClassDetailView vehicleClass={vc} />
    </IntlProvider>,
  )
}

describe('ClassDetailView', () => {
  it('renders the class name and seat spec', () => {
    renderDetail(makeClass({ name: 'Compact' }))
    expect(screen.getByText('Compact')).toBeInTheDocument()
    expect(screen.getByText('5 seats')).toBeInTheDocument()
  })

  // #457: class-default luggage count + size in the specs grid.
  it('shows the luggage count and size in the specs', () => {
    renderDetail(makeClass({ luggageCapacity: 3, luggageSize: 'LARGE' }))
    expect(screen.getByText('3 bags')).toBeInTheDocument()
    expect(screen.getByText(/Large/)).toBeInTheDocument()
  })

  it('renders a singular bag label for a one-bag class', () => {
    renderDetail(makeClass({ luggageCapacity: 1, luggageSize: 'SMALL' }))
    expect(screen.getByText('1 bag')).toBeInTheDocument()
  })

  it('gives every gallery image explicit 4:3 dimensions', () => {
    renderDetail(makeClass({ photos: ['p0.jpg', 'p1.jpg', 'p2.jpg'] }))
    const images = screen.getAllByRole('img')
    expect(images.length).toBeGreaterThan(1)
    for (const img of images) {
      expect(img).toHaveAttribute('width', '400')
      expect(img).toHaveAttribute('height', '300')
    }
  })
})
