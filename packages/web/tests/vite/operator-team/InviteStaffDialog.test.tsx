import { ApiError } from '@/lib/api-error'
import { InviteStaffDialog } from '@/vite/operator-team/InviteStaffDialog'
import * as api from '@/vite/operator-team/api'
import { TEAM_INVITES_QUERY_KEY } from '@/vite/operator-team/api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

vi.mock('@/vite/operator-team/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-team/api')>()
  return { ...actual, inviteStaff: vi.fn() }
})

const inviteStaff = vi.mocked(api.inviteStaff)
const en = enMessages.business.team

function renderDialog(operatorId = 'op_1') {
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <InviteStaffDialog
          open={true}
          onOpenChange={onOpenChange}
          csrfToken="csrf-token"
          operatorId={operatorId}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidateSpy }
}

describe('InviteStaffDialog', () => {
  afterEach(() => {
    cleanup()
    inviteStaff.mockReset()
  })

  it('sends an invite with the email, csrf token, and operatorId, then invalidates invites', async () => {
    inviteStaff.mockResolvedValue({
      inviteUrl: 'https://example.com/invite/token_abc',
      expiresAt: '2026-07-09T00:00:00.000Z',
    })
    const user = userEvent.setup()
    const { invalidateSpy } = renderDialog()

    await user.type(screen.getByLabelText(en.form.email), 'staff@example.com')
    await user.click(screen.getByRole('button', { name: en.form.submit }))

    await waitFor(() => expect(inviteStaff).toHaveBeenCalledTimes(1))
    expect(inviteStaff.mock.calls[0][0]).toEqual({ email: 'staff@example.com' })
    expect(inviteStaff.mock.calls[0][1]).toBe('csrf-token')
    expect(inviteStaff.mock.calls[0][2]).toBe('op_1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: TEAM_INVITES_QUERY_KEY })
  })

  it('reveals the invite URL on success and does not close', async () => {
    inviteStaff.mockResolvedValue({
      inviteUrl: 'https://example.com/invite/token_abc',
      expiresAt: '2026-07-09T00:00:00.000Z',
    })
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()

    await user.type(screen.getByLabelText(en.form.email), 'staff@example.com')
    await user.click(screen.getByRole('button', { name: en.form.submit }))

    expect(
      await screen.findByDisplayValue('https://example.com/invite/token_abc'),
    ).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('surfaces a server error inline and keeps the form open', async () => {
    inviteStaff.mockRejectedValue(new ApiError('Email already invited', 409))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog()

    await user.type(screen.getByLabelText(en.form.email), 'staff@example.com')
    await user.click(screen.getByRole('button', { name: en.form.submit }))

    expect(await screen.findByText('Email already invited')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
