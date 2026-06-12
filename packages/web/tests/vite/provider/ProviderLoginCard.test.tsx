import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      signInTitle: 'Provider sign in',
      signInSubtitle: 'Manage your fleet',
      continueAsProvider: 'Continue as a provider',
    }
    return messages[key] ?? key
  },
}))

import { ProviderLoginCard } from '@/vite/provider/ProviderLoginCard'

afterEach(() => cleanup())

describe('ProviderLoginCard', () => {
  it('renders the provider title and subtitle', () => {
    render(<ProviderLoginCard returnTo="/en/manage" />)
    expect(screen.getByRole('heading', { name: 'Provider sign in' })).toBeInTheDocument()
    expect(screen.getByText('Manage your fleet')).toBeInTheDocument()
  })

  it('POSTs to /auth/google/start with intent=provider and the encoded returnTo', () => {
    render(<ProviderLoginCard returnTo="/ja/manage" />)
    const form = screen.getByRole('button', { name: /continue as a provider/i }).closest('form')
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post')
    expect(form?.getAttribute('action')).toBe(
      `/auth/google/start?intent=provider&returnTo=${encodeURIComponent('/ja/manage')}`,
    )
  })
})
