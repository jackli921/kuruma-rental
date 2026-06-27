import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import { ProviderInviteDialog } from './ProviderInviteDialog'
import type { CreatedInvite } from './api'

const T = en.admin.operators.inviteDialog

const INVITE: CreatedInvite = {
  token: 'tok_abc123',
  inviteUrl: 'https://app.example.com/provider/invite/tok_abc123',
  expiresAt: '2026-07-01T00:00:00.000Z',
}

type Props = Parameters<typeof ProviderInviteDialog>[0]

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onOpenChange: vi.fn(),
    operatorName: 'Kanata Cars',
    created: null,
    isPending: false,
    error: null,
    onSubmit: vi.fn(),
    ...over,
  }
  render(
    <IntlProvider locale="en" messages={en}>
      <ProviderInviteDialog {...props} />
    </IntlProvider>,
  )
  return props
}

afterEach(() => vi.unstubAllGlobals())

describe('ProviderInviteDialog', () => {
  it('submits the entered email and selected role', () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText(T.emailLabel), {
      target: { value: 'staff@example.com' },
    })
    fireEvent.change(screen.getByLabelText(T.roleLabel), {
      target: { value: 'OPERATOR_STAFF' },
    })
    fireEvent.click(screen.getByRole('button', { name: T.submit }))
    expect(props.onSubmit).toHaveBeenCalledWith({
      email: 'staff@example.com',
      role: 'OPERATOR_STAFF',
    })
  })

  it('reveals the one-time invite link and copies it to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    setup({ created: INVITE })

    // The link is shown exactly once, in a readonly field — the form is gone.
    expect(screen.getByDisplayValue(INVITE.inviteUrl)).not.toBeNull()
    expect(screen.queryByLabelText(T.emailLabel)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: T.copy }))
    expect(writeText).toHaveBeenCalledWith(INVITE.inviteUrl)
    expect(await screen.findByRole('button', { name: T.copied })).not.toBeNull()
  })

  it('renders the failure message when the mint fails', () => {
    setup({ error: 'Operator not found' })
    expect(screen.getByText('Operator not found')).not.toBeNull()
  })
})
