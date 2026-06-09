import { CallToAction } from '@/vite/landing/CallToAction'
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
  }: { to: string; params?: { locale?: string }; children: ReactNode }) => (
    <a href={to} data-to={to} data-locale={params?.locale}>
      {children}
    </a>
  ),
}))

function renderCta() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <CallToAction />
    </IntlProvider>,
  )
}

describe('CallToAction', () => {
  it('renders the heading and a button linking to the locale-scoped catalog', () => {
    renderCta()
    expect(screen.getByText('Ready to explore Japan?')).toBeInTheDocument()
    const link = screen.getByText('Find your car').closest('a')
    expect(link).toHaveAttribute('data-to', '/$locale/vehicles')
    expect(link).toHaveAttribute('data-locale', 'en')
  })
})
