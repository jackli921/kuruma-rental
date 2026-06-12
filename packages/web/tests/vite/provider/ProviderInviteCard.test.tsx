import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) => {
    const messages: Record<string, string> = {
      'invite.title': `You're invited to ${params?.operator ?? ''}`,
      'invite.subtitle': 'Sign in with the invited Google account to join.',
      'invite.continue': 'Accept with Google',
      'invite.expiredTitle': 'Invite unavailable',
      'invite.expiredBody': 'This invite has expired or has already been used.',
    }
    return messages[key] ?? key
  },
}))

import { ProviderInviteCard } from '@/vite/provider/ProviderInviteCard'

afterEach(() => cleanup())

describe('ProviderInviteCard', () => {
  it('names the operator and POSTs the invite token + provider intent for a valid invite', () => {
    render(
      <ProviderInviteCard
        preview={{ valid: true, operatorName: 'Pilot Operator', expiresAt: '2026-07-01T00:00:00Z' }}
        token="tok-123"
        returnTo="/en/manage"
      />,
    )

    expect(
      screen.getByRole('heading', { name: "You're invited to Pilot Operator" }),
    ).toBeInTheDocument()
    const form = screen.getByRole('button', { name: /accept with google/i }).closest('form')
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('post')
    expect(form?.getAttribute('action')).toBe(
      `/auth/google/start?intent=provider&invite=tok-123&returnTo=${encodeURIComponent('/en/manage')}`,
    )
  })

  it('shows the unavailable state with no accept button for an invalid invite', () => {
    render(<ProviderInviteCard preview={{ valid: false }} token="tok-123" returnTo="/en/manage" />)

    expect(screen.getByRole('heading', { name: 'Invite unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept with google/i })).toBeNull()
  })
})
