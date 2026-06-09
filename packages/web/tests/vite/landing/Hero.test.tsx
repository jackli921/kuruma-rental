import { Hero } from '@/vite/landing/Hero'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'

// Hero embeds SearchWidget, which reaches for TanStack navigation.
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

function renderHero() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <Hero />
    </IntlProvider>,
  )
}

describe('Hero', () => {
  it('renders the headline, subtitle, and the embedded search widget', () => {
    renderHero()
    expect(screen.getByText('Explore Japan at your own pace')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Pick up a car in Osaka and drive anywhere. No approval wait, no hidden fees.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
  })
})
