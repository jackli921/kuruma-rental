import { Footer } from '@/vite/landing/Footer'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'

function renderFooter() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <Footer />
    </IntlProvider>,
  )
}

describe('Footer', () => {
  it('renders the copyright with the current year and the tagline', () => {
    renderFooter()
    const year = new Date().getFullYear()
    expect(
      screen.getByText(new RegExp(`${year} Kuruma Rental\\. All rights reserved\\.`)),
    ).toBeInTheDocument()
    expect(screen.getByText('Car rental in Osaka, Japan')).toBeInTheDocument()
  })
})
