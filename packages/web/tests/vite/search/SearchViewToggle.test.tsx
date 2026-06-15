import { SearchViewToggle } from '@/vite/search/SearchViewToggle'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Stub TanStack Link → a plain anchor. The functional `search` updater is
// resolved against a prev that carries a region so a test can assert the toggle
// preserves it (#840); the function itself is never spread onto the DOM node.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params?: { locale?: string }
    search?: ((prev: Record<string, unknown>) => Record<string, unknown>) | Record<string, unknown>
    children: ReactNode
  }) => {
    const resolved = typeof search === 'function' ? search({ region: 'namba' }) : search
    return (
      <a
        href={to}
        data-to={to}
        data-locale={params?.locale}
        data-region={typeof resolved?.region === 'string' ? resolved.region : undefined}
        {...rest}
      >
        {children}
      </a>
    )
  },
}))

function renderToggle(view: 'stores' | 'map') {
  return render(
    <IntlProvider locale="en" messages={en}>
      <SearchViewToggle view={view} locale="en" />
    </IntlProvider>,
  )
}

describe('SearchViewToggle', () => {
  it('renders a Stores and a Map link', () => {
    renderToggle('stores')
    expect(screen.getByRole('link', { name: 'Stores' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Map' })).toBeInTheDocument()
  })

  it('marks only the Map link current when view=map', () => {
    renderToggle('map')
    const current = screen.getByRole('link', { current: 'page' })
    expect(current).toHaveTextContent('Map')
    expect(screen.getByRole('link', { name: 'Stores' })).not.toHaveAttribute('aria-current')
  })

  it('marks only the Stores link current when view=stores', () => {
    renderToggle('stores')
    const current = screen.getByRole('link', { current: 'page' })
    expect(current).toHaveTextContent('Stores')
    expect(screen.getByRole('link', { name: 'Map' })).not.toHaveAttribute('aria-current')
  })

  it('points both links at the locale-scoped search route', () => {
    renderToggle('stores')
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('data-to', '/$locale/search')
      expect(link).toHaveAttribute('data-locale', 'en')
    }
  })

  it('preserves the chosen region across the grid/map toggle so nearest-first survives the switch (#840)', () => {
    renderToggle('stores')
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('data-region', 'namba')
    }
  })
})
