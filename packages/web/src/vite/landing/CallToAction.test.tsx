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

import { CallToAction } from './CallToAction'

describe('CallToAction', () => {
  it('sends the primary CTA into the real /search funnel, not the /vehicles catalog', () => {
    render(
      <IntlProvider locale="en" messages={en}>
        <CallToAction />
      </IntlProvider>,
    )
    expect(screen.getByText(en.landing.cta.heading)).not.toBeNull()
    const cta = screen.getByText(en.landing.cta.button).closest('a')
    expect(cta?.getAttribute('data-to')).toBe('/$locale/search')
  })
})
