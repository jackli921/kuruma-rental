import { ApiError } from '@/lib/api-error'
import { RevokeInviteDialog } from '@/vite/operator-team/RevokeInviteDialog'
import * as api from '@/vite/operator-team/api'
import { TEAM_INVITES_QUERY_KEY } from '@/vite/operator-team/api'
import type { OperatorInviteData } from '@kuruma/shared/types/operator-team'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

vi.mock('@/vite/operator-team/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-team/api')>()
  return { ...actual, revokeInvite: vi.fn() }
})

const revokeInvite = vi.mocked(api.revokeInvite)
const en = enMessages.business.team

function invite(overrides: Partial<OperatorInviteData> = {}): OperatorInviteData {
  return {
    id: 'inv_1',
    email: 'staff@example.com',
    role: 'OPERATOR_STAFF',
    status: 'PENDING',
    expiresAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderDialog(inv: OperatorInviteData | null, operatorId = 'op_1') {
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <RevokeInviteDialog
          invite={inv}
          onOpenChange={onOpenChange}
          csrfToken="csrf-token"
          operatorId={operatorId}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidateSpy }
}

describe('RevokeInviteDialog', () => {
  afterEach(() => {
    cleanup()
    revokeInvite.mockReset()
  })

  it('revokes by id with the csrf token, invalidates invites, and closes', async () => {
    revokeInvite.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { onOpenChange, invalidateSpy } = renderDialog(invite())

    await user.click(screen.getByRole('button', { name: en.revokeConfirm }))

    await waitFor(() => expect(revokeInvite).toHaveBeenCalledTimes(1))
    expect(revokeInvite.mock.calls[0][0]).toBe('inv_1')
    expect(revokeInvite.mock.calls[0][1]).toBe('csrf-token')
    expect(revokeInvite.mock.calls[0][2]).toBe('op_1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: TEAM_INVITES_QUERY_KEY })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces a server failure message inline and keeps the dialog open', async () => {
    revokeInvite.mockRejectedValue(new ApiError('Invite not found', 404))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog(invite())

    await user.click(screen.getByRole('button', { name: en.revokeConfirm }))

    expect(await screen.findByText('Invite not found')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
