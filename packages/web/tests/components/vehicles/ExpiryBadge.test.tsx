import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'expiry.shaken.OK': 'Shaken OK',
      'expiry.shaken.EXPIRING_SOON': 'Shaken expiring',
      'expiry.shaken.EXPIRED': 'Shaken expired',
      'expiry.shaken.UNKNOWN': 'No shaken',
      'expiry.insurance.OK': 'Insured',
      'expiry.insurance.EXPIRING_SOON': 'Insurance expiring',
      'expiry.insurance.EXPIRED': 'Insurance expired',
      'expiry.insurance.UNKNOWN': 'No insurance',
    }
    return messages[key] ?? key
  },
}))

import { ExpiryBadge } from '@/components/vehicles/ExpiryBadge'

describe('ExpiryBadge', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders correct text for shaken OK status', () => {
    render(<ExpiryBadge status="OK" label="shaken" />)

    expect(screen.getByTestId('expiry-badge')).toHaveTextContent('Shaken OK')
  })

  it('renders correct text for shaken EXPIRING_SOON status', () => {
    render(<ExpiryBadge status="EXPIRING_SOON" label="shaken" />)

    expect(screen.getByTestId('expiry-badge')).toHaveTextContent('Shaken expiring')
  })

  it('renders correct text for insurance EXPIRED status', () => {
    render(<ExpiryBadge status="EXPIRED" label="insurance" />)

    expect(screen.getByTestId('expiry-badge')).toHaveTextContent('Insurance expired')
  })

  it('renders correct text for insurance UNKNOWN status', () => {
    render(<ExpiryBadge status="UNKNOWN" label="insurance" />)

    expect(screen.getByTestId('expiry-badge')).toHaveTextContent('No insurance')
  })

  it('uses destructive variant for EXPIRED status', () => {
    const { container } = render(<ExpiryBadge status="EXPIRED" label="shaken" />)

    // The destructive variant applies bg-destructive classes
    const badge = container.querySelector('[data-testid="expiry-badge"]')
    expect(badge?.className).toMatch(/destructive/)
  })

  it('uses secondary variant for OK status', () => {
    const { container } = render(<ExpiryBadge status="OK" label="shaken" />)

    const badge = container.querySelector('[data-testid="expiry-badge"]')
    expect(badge?.className).toMatch(/secondary/)
  })

  it('uses amber styling for EXPIRING_SOON status', () => {
    const { container } = render(<ExpiryBadge status="EXPIRING_SOON" label="insurance" />)

    const badge = container.querySelector('[data-testid="expiry-badge"]')
    expect(badge?.className).toMatch(/amber/)
  })
})
