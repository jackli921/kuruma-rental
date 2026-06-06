import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PreAuthHandoffCard } from '@/components/bookings/PreAuthHandoffCard'

// §5.1 (#393): the pre-auth handoff CTA is renter-facing and links to the
// operator's EXTERNAL pre-auth URL (not the i18n Link). It must render the exact
// URL when present and disappear entirely when the operator has none (null).
describe('PreAuthHandoffCard', () => {
  afterEach(() => {
    cleanup()
  })

  const copy = {
    title: 'Secure your booking',
    explain: 'Your card is pre-authorized at pickup, not charged now.',
    ctaLabel: 'Complete pre-authorization',
    cancellationContact: 'To change or cancel, contact Best Car Rental.',
  }

  it('renders the CTA as an external link with the exact pre-auth URL', () => {
    render(<PreAuthHandoffCard url="https://pay.example.com/preauth/abc" {...copy} />)

    const cta = screen.getByRole('link', { name: 'Complete pre-authorization' })
    expect(cta).toHaveAttribute('href', 'https://pay.example.com/preauth/abc')
    expect(cta.getAttribute('target')).toBe('_blank')
    expect(cta.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText('Secure your booking')).toBeInTheDocument()
    expect(
      screen.getByText('Your card is pre-authorized at pickup, not charged now.'),
    ).toBeInTheDocument()
  })

  it('renders nothing when the operator has no pre-auth URL (null)', () => {
    const { container } = render(<PreAuthHandoffCard url={null} {...copy} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
