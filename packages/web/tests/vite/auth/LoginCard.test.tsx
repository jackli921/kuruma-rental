import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      signInTitle: 'Sign in',
      signInSubtitle: 'Continue to Best Car Rental',
      continueWithGoogle: 'Continue with Google',
    }
    return messages[key] ?? key
  },
}))

import { LoginCard } from '@/vite/auth/LoginCard'

afterEach(() => cleanup())

describe('LoginCard', () => {
  it('renders the title and subtitle', () => {
    render(<LoginCard />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Continue to Best Car Rental')).toBeInTheDocument()
  })

  it('submits a POST form to /auth/google/start (no returnTo)', () => {
    render(<LoginCard />)
    const button = screen.getByRole('button', { name: /continue with google/i })
    const form = button.closest('form')
    expect(form).not.toBeNull()
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post')
    expect(form?.getAttribute('action')).toBe('/auth/google/start')
  })

  it('carries an encoded returnTo on the form action', () => {
    render(<LoginCard returnTo="/ja/bookings/new?from=2026-06-10T09:00" />)
    const form = screen.getByRole('button', { name: /continue with google/i }).closest('form')
    expect(form?.getAttribute('action')).toBe(
      `/auth/google/start?returnTo=${encodeURIComponent('/ja/bookings/new?from=2026-06-10T09:00')}`,
    )
  })

  // #521 Slice D regression guard: the provider work extracted GoogleIcon into a
  // shared component and added an intent=provider door. The renter door must stay
  // intent-free (intent=provider would run the operator-grant path on a renter).
  it('keeps the renter door free of any provider intent and renders the shared Google icon', () => {
    render(<LoginCard />)
    const button = screen.getByRole('button', { name: /continue with google/i })
    expect(button.closest('form')?.getAttribute('action')).not.toContain('intent')
    expect(button.querySelector('svg')).not.toBeNull()
  })
})
