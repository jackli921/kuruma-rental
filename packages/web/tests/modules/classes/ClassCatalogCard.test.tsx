import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Only the 8 dictionary codes exist under the `acriss` namespace; an
// off-dictionary code must fall back to the raw code via t.has().
const ACRISS_LABELS: Record<string, string> = {
  CCAR: 'Compact',
  SUVR: 'SUV',
  MCAR: 'Mini',
}

const SIZE_LABELS: Record<string, string> = { SMALL: 'Small', MEDIUM: 'Medium', LARGE: 'Large' }

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        seats: '{count} seats',
        luggage: '{count} bags',
        auto: 'Auto',
        manual: 'Manual',
        perDay: '/ day',
        priceFrom: 'From',
        viewClass: 'View class',
      }
      const template =
        namespace === 'acriss'
          ? (ACRISS_LABELS[key] ?? key)
          : namespace === 'luggageSize'
            ? (SIZE_LABELS[key] ?? key)
            : (messages[key] ?? key)
      if (!values) return template
      return Object.entries(values).reduce<string>(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        template,
      )
    }
    t.has = (key: string) => (namespace === 'acriss' ? key in ACRISS_LABELS : true)
    return t
  },
}))

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// Import directly from components to avoid pulling the module barrel's
// api.ts chain (which imports Auth.js → next/server) into the test env.
import { ClassCatalogCard } from '@/modules/classes/components/ClassCatalogCard'

const baseClass = {
  id: 'c1',
  name: 'Compact',
  slug: 'compact',
  description: 'A small runabout',
  photos: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
  seats: 5,
  luggageCapacity: 2,
  luggageSize: 'MEDIUM' as const,
  transmission: 'AUTO' as const,
  fuelType: 'GASOLINE',
  acrissCode: null,
  sortOrder: 0,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('ClassCatalogCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('links to the class detail page by slug', () => {
    render(<ClassCatalogCard vehicleClass={baseClass} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/vehicles/classes/compact')
  })

  it('shows name, seats, and transmission', () => {
    render(<ClassCatalogCard vehicleClass={baseClass} />)
    expect(screen.getByText('Compact')).toBeInTheDocument()
    expect(screen.getByText('5 seats')).toBeInTheDocument()
    expect(screen.getByText('Auto')).toBeInTheDocument()
  })

  it('shows luggage capacity and size (#457)', () => {
    render(<ClassCatalogCard vehicleClass={baseClass} />)
    expect(screen.getByText('2 bags')).toBeInTheDocument()
    expect(screen.getByText(/Medium/)).toBeInTheDocument()
  })

  it('renders no price on the card (#406 — class pricing dropped; "from" price is slice 5)', () => {
    render(<ClassCatalogCard vehicleClass={baseClass} />)
    expect(screen.queryByText(/[¥￥]/)).toBeNull()
  })

  it('renders the first photo as hero image with alt=name', () => {
    render(<ClassCatalogCard vehicleClass={baseClass} />)
    const img = screen.getByRole('img', { name: 'Compact' })
    expect(img).toHaveAttribute('src', 'https://example.com/a.jpg')
  })

  it('renders placeholder when no photos are present', () => {
    render(<ClassCatalogCard vehicleClass={{ ...baseClass, photos: [] }} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows Manual transmission correctly', () => {
    render(<ClassCatalogCard vehicleClass={{ ...baseClass, transmission: 'MANUAL' }} />)
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('renders the locale-correct ACRISS label for an in-dictionary code', () => {
    // Name 'Big Wagon' avoids colliding with the 'SUV' badge label.
    render(
      <ClassCatalogCard vehicleClass={{ ...baseClass, name: 'Big Wagon', acrissCode: 'SUVR' }} />,
    )
    expect(screen.getByText('SUV')).toBeInTheDocument()
  })

  it('falls back to the raw code for an off-dictionary ACRISS code (no missing-key crash)', () => {
    // IFAR is format-valid but not in the 8-key dictionary — the renter surface
    // must show the raw code, never throw a missing-message error (#388).
    render(<ClassCatalogCard vehicleClass={{ ...baseClass, acrissCode: 'IFAR' }} />)
    expect(screen.getByText('IFAR')).toBeInTheDocument()
  })

  it('renders no ACRISS badge when acrissCode is null', () => {
    render(
      <ClassCatalogCard vehicleClass={{ ...baseClass, name: 'Big Wagon', acrissCode: null }} />,
    )
    // No dictionary label appears (name is 'Big Wagon', not a label).
    expect(screen.queryByText('SUV')).toBeNull()
    expect(screen.queryByText('Mini')).toBeNull()
  })
})
