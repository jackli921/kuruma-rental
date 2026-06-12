import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('use-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      accessNotFoundTitle: 'No operator access',
      accessNotFoundBody: 'This Google account is not linked to any operator.',
      inviteInvalidTitle: 'Invite not valid',
      inviteInvalidBody: 'This invite is expired, used, or for a different email.',
      requestAccess: 'Request access',
    }
    return messages[key] ?? key
  },
}))

import { ProviderAccessDeniedPanel } from '@/vite/provider/ProviderAccessDeniedPanel'

afterEach(() => cleanup())

describe('ProviderAccessDeniedPanel', () => {
  it('shows the access-not-found copy and a request-access mailto link', () => {
    render(<ProviderAccessDeniedPanel error="access_not_found" />)

    expect(screen.getByRole('heading', { name: 'No operator access' })).toBeInTheDocument()
    expect(
      screen.getByText('This Google account is not linked to any operator.'),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Request access' })
    expect(link.getAttribute('href')).toMatch(/^mailto:.+@.+/)
  })

  it('shows the invite-invalid copy for a bad or expired invite', () => {
    render(<ProviderAccessDeniedPanel error="invite_invalid" />)

    expect(screen.getByRole('heading', { name: 'Invite not valid' })).toBeInTheDocument()
    expect(
      screen.getByText('This invite is expired, used, or for a different email.'),
    ).toBeInTheDocument()
    // The denied state never offers the Google sign-in button.
    expect(screen.queryByRole('button')).toBeNull()
  })
})
