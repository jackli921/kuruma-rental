import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to?: string }) => (
    <a href="#link" data-to={to}>
      {children}
    </a>
  ),
}))

import { Footer } from './Footer'

function renderFooter() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <Footer />
    </IntlProvider>,
  )
}

const T = en.landing.footer

describe('Footer', () => {
  it('links to existing renter routes only (no manufactured dead links)', () => {
    renderFooter()
    const byLabel = (label: string) => screen.getByText(label).closest('a')
    expect(byLabel(T.browse)?.getAttribute('data-to')).toBe('/$locale/search')
    expect(byLabel(T.categories)?.getAttribute('data-to')).toBe('/$locale/vehicles')
    expect(byLabel(T.signIn)?.getAttribute('data-to')).toBe('/$locale/login')
  })

  it('still shows the copyright with the current year and the tagline', () => {
    renderFooter()
    const year = new Date().getFullYear()
    expect(screen.getByText(new RegExp(`${year} ${T.copyright}`))).not.toBeNull()
    expect(screen.getByText(T.tagline)).not.toBeNull()
  })
})
