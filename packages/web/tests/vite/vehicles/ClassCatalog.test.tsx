import { ClassCatalog } from '@/vite/vehicles/ClassCatalog'
import type { VehicleClassData } from '@/vite/vehicles/classes'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: { to: string; params?: { slug?: string }; children: ReactNode }) => (
    <a href={to} data-to={to} data-slug={params?.slug}>
      {children}
    </a>
  ),
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

function renderCatalog(classes: VehicleClassData[]) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ClassCatalog classes={classes} />
    </IntlProvider>,
  )
}

describe('ClassCatalog', () => {
  it('shows the empty message when there are no classes', () => {
    renderCatalog([])
    expect(screen.getByText('No classes available right now.')).toBeInTheDocument()
  })

  it('renders a card per class linking to the locale-scoped detail route', () => {
    renderCatalog([
      makeClass({ name: 'Compact', slug: 'compact' }),
      makeClass({ id: 'c2', name: 'Van', slug: 'van' }),
    ])
    expect(screen.getByText('Compact')).toBeInTheDocument()
    const vanLink = screen.getByText('Van').closest('a')
    expect(vanLink).toHaveAttribute('data-to', '/$locale/vehicles/classes/$slug')
    expect(vanLink).toHaveAttribute('data-slug', 'van')
  })

  // #457: class-default luggage on each catalog card.
  it('shows the class luggage count and size on the card', () => {
    renderCatalog([makeClass({ luggageCapacity: 3, luggageSize: 'LARGE' })])
    expect(screen.getByText('3 bags')).toBeInTheDocument()
    expect(screen.getByText(/Large/)).toBeInTheDocument()
  })

  // Seed data has one-bag classes (Kei car) — the count must pluralize.
  it('renders a singular bag label for a one-bag class', () => {
    renderCatalog([makeClass({ luggageCapacity: 1, luggageSize: 'SMALL' })])
    expect(screen.getByText('1 bag')).toBeInTheDocument()
  })
})
