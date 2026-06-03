import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Only these codes exist under the `acriss` namespace; an off-dictionary code
// must fall back to the raw code via t.has().
const ACRISS_LABELS: Record<string, string> = { CCAR: 'Compact', SUVR: 'SUV' }

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        backToCatalog: 'Back to catalog',
        specs: 'Specifications',
        seats: '{count} seats',
        transmission: 'Transmission',
        fuelType: 'Fuel type',
        acrissCode: 'ACRISS class',
        luggage: '{count} bags',
        auto: 'Automatic',
        manual: 'Manual',
        photos: 'Photos',
        bookCta: 'Check availability',
        priceFrom: 'From',
        perDay: '/ day',
      }
      const template = namespace === 'acriss' ? (ACRISS_LABELS[key] ?? key) : (messages[key] ?? key)
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

// Direct import to avoid pulling module barrel's api-client chain.
import { ClassDetailView } from '@/modules/classes/components/ClassDetailView'

const baseClass = {
  id: 'c1',
  name: 'Compact',
  slug: 'compact',
  description: 'A small runabout that parks anywhere.',
  photos: ['https://example.com/a.jpg', 'https://example.com/b.jpg', 'https://example.com/c.jpg'],
  seats: 5,
  luggageCapacity: 2,
  transmission: 'AUTO' as const,
  fuelType: 'GASOLINE',
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  acrissCode: null,
  sortOrder: 0,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('ClassDetailView', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the class name as the page heading', () => {
    render(<ClassDetailView vehicleClass={baseClass} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Compact' })).toBeInTheDocument()
  })

  it('renders the description', () => {
    render(<ClassDetailView vehicleClass={baseClass} />)
    expect(screen.getByText('A small runabout that parks anywhere.')).toBeInTheDocument()
  })

  it('renders the primary photo with alt=name', () => {
    render(<ClassDetailView vehicleClass={baseClass} />)
    const imgs = screen.getAllByRole('img', { name: 'Compact' })
    expect(imgs[0]).toHaveAttribute('src', 'https://example.com/a.jpg')
  })

  it('renders up to 3 additional photos in the thumbnail grid', () => {
    render(<ClassDetailView vehicleClass={baseClass} />)
    const imgs = screen.getAllByRole('img', { name: 'Compact' })
    // 1 hero + 2 thumbs = 3 total
    expect(imgs).toHaveLength(3)
  })

  it('links back to /vehicles', () => {
    render(<ClassDetailView vehicleClass={baseClass} />)
    const back = screen.getByRole('link', { name: /Back to catalog/ })
    expect(back).toHaveAttribute('href', '/vehicles')
  })

  it('renders the Book CTA linking to /bookings/new?classSlug=compact', () => {
    render(<ClassDetailView vehicleClass={baseClass} />)
    const cta = screen.getByRole('link', { name: /Check availability/ })
    expect(cta).toHaveAttribute('href', '/bookings/new?classSlug=compact')
  })

  it('shows seats, transmission, luggage, fuel type in specs', () => {
    render(<ClassDetailView vehicleClass={baseClass} />)
    expect(screen.getByText('5 seats')).toBeInTheDocument()
    expect(screen.getByText('Automatic')).toBeInTheDocument()
    expect(screen.getByText('2 bags')).toBeInTheDocument()
    expect(screen.getByText('GASOLINE')).toBeInTheDocument()
  })

  it('hides price and fuel section when missing', () => {
    render(<ClassDetailView vehicleClass={{ ...baseClass, dailyRateJpy: null, fuelType: null }} />)
    expect(screen.queryByText(/[¥￥]/)).toBeNull()
    expect(screen.queryByText('GASOLINE')).toBeNull()
  })

  it('renders a placeholder when photos is empty', () => {
    render(<ClassDetailView vehicleClass={{ ...baseClass, photos: [] }} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows the locale ACRISS label for an in-dictionary code', () => {
    render(<ClassDetailView vehicleClass={{ ...baseClass, acrissCode: 'SUVR' }} />)
    expect(screen.getByText('SUV')).toBeInTheDocument()
  })

  it('falls back to the raw code for an off-dictionary ACRISS code (no missing-key crash)', () => {
    render(<ClassDetailView vehicleClass={{ ...baseClass, acrissCode: 'IFAR' }} />)
    expect(screen.getByText('IFAR')).toBeInTheDocument()
  })
})
