import { formatJpy } from '@/lib/format'
import { FeaturedVehicles } from '@/vite/landing/FeaturedVehicles'
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
    ...rest
  }: { to: string; params?: { locale?: string }; children: ReactNode }) => (
    <a href={to} data-to={to} data-locale={params?.locale} {...rest}>
      {children}
    </a>
  ),
}))

function renderFeatured() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <FeaturedVehicles />
    </IntlProvider>,
  )
}

describe('FeaturedVehicles', () => {
  it('renders a card per curated vehicle with its formatted price', () => {
    renderFeatured()
    expect(screen.getByText('Honda N-BOX')).toBeInTheDocument()
    expect(screen.getByText('Toyota Alphard')).toBeInTheDocument()
    expect(screen.getByText(formatJpy(3500))).toBeInTheDocument()
    expect(screen.getByText(formatJpy(12000))).toBeInTheDocument()
  })

  it('points every link at the locale-scoped catalog', () => {
    renderFeatured()
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute('data-to', '/$locale/vehicles')
      expect(link).toHaveAttribute('data-locale', 'en')
    }
  })

  it('gives every featured image explicit 4:3 dimensions so the box reserves space before load', () => {
    renderFeatured()
    const images = screen.getAllByRole('img')
    expect(images.length).toBeGreaterThan(0)
    for (const img of images) {
      expect(img).toHaveAttribute('width', '400')
      expect(img).toHaveAttribute('height', '300')
    }
  })
})
