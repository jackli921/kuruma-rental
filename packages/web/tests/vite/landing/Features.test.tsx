import { Features } from '@/vite/landing/Features'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function renderFeatures() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <Features />
    </IntlProvider>,
  )
}

describe('Features', () => {
  it('renders the eyebrow, heading, and all four feature titles', () => {
    renderFeatures()
    expect(screen.getByText('Why Kuruma')).toBeInTheDocument()
    expect(screen.getByText('Everything you need for the road')).toBeInTheDocument()
    for (const title of [
      'Instant booking',
      'Flexible hours',
      'Multilingual support',
      'Curated fleet',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
  })
})
