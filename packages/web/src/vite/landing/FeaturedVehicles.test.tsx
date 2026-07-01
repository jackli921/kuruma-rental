import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Stub the router Link so the pure section renders without a RouterProvider (repo
// test pattern), exposing the destination + search so navigation can be asserted.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode
    to?: string
    search?: Record<string, unknown>
    className?: string
  }) => (
    <a href="#link" data-to={to} data-search={JSON.stringify(search ?? null)} className={className}>
      {children}
    </a>
  ),
}))

import { FeaturedVehicles } from './FeaturedVehicles'

function renderSection() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <FeaturedVehicles />
    </IntlProvider>,
  )
}

function links(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll('a[data-to]'))
}

describe('FeaturedVehicles', () => {
  it('routes every link into the real /search funnel, never the /vehicles dead end', () => {
    renderSection()
    const targets = links().map((a) => a.getAttribute('data-to'))
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.every((t) => t === '/$locale/search')).toBe(true)
    expect(targets).not.toContain('/$locale/vehicles')
  })

  it('deep-links each category tile into /search prefiltered by its ACRISS class', () => {
    renderSection()
    // The four category tiles carry a `class` search param; the View-all links do not.
    const classParams = links()
      .map((a) => JSON.parse(a.getAttribute('data-search') ?? 'null'))
      .filter((s): s is { class: string } => s !== null && typeof s.class === 'string')
      .map((s) => s.class)
    expect(classParams).toEqual(['MCAR', 'CCAR', 'SUVR', 'IVAR'])
  })

  it('labels the tiles with their localized ACRISS category names', () => {
    renderSection()
    expect(screen.getByText(en.acriss.MCAR)).not.toBeNull()
    expect(screen.getByText(en.acriss.CCAR)).not.toBeNull()
    expect(screen.getByText(en.acriss.SUVR)).not.toBeNull()
    expect(screen.getByText(en.acriss.IVAR)).not.toBeNull()
  })

  it('gives every tile image explicit 4:3 dimensions so the box reserves space before load (#846)', () => {
    renderSection()
    const images = screen.getAllByRole('img')
    expect(images.length).toBe(4)
    for (const img of images) {
      expect(img.getAttribute('width')).toBe('400')
      expect(img.getAttribute('height')).toBe('300')
    }
  })
})
