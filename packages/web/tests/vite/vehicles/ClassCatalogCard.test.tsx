import { ClassCatalogCard } from '@/vite/vehicles/ClassCatalogCard'
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

function renderCard(vc: VehicleClassData) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ClassCatalogCard vehicleClass={vc} />
    </IntlProvider>,
  )
}

describe('ClassCatalogCard', () => {
  it('gives the class photo explicit 4:3 dimensions when present', () => {
    renderCard(makeClass({ name: 'Compact', photos: ['https://cdn.example/compact.jpg'] }))
    const img = screen.getByRole('img', { name: 'Compact' })
    expect(img).toHaveAttribute('width', '400')
    expect(img).toHaveAttribute('height', '300')
  })
})
