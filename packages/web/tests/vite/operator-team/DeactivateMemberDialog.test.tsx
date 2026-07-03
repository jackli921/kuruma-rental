import { ApiError } from '@/lib/api-error'
import { DeactivateMemberDialog } from '@/vite/operator-team/DeactivateMemberDialog'
import * as api from '@/vite/operator-team/api'
import { TEAM_MEMBERS_QUERY_KEY } from '@/vite/operator-team/api'
import type { OperatorMemberData } from '@kuruma/shared/types/operator-team'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

vi.mock('@/vite/operator-team/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-team/api')>()
  return { ...actual, deactivateMember: vi.fn() }
})

const deactivateMember = vi.mocked(api.deactivateMember)
const en = enMessages.business.team

function member(overrides: Partial<OperatorMemberData> = {}): OperatorMemberData {
  return {
    id: 'mem_1',
    userId: 'usr_1',
    name: 'Aiko Tanaka',
    email: 'aiko@example.com',
    role: 'OPERATOR_STAFF',
    status: 'ACTIVE',
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderDialog(mem: OperatorMemberData | null, operatorId = 'op_1') {
  const onOpenChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={enMessages}>
        <DeactivateMemberDialog
          member={mem}
          onOpenChange={onOpenChange}
          csrfToken="csrf-token"
          operatorId={operatorId}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
  return { onOpenChange, invalidateSpy }
}

describe('DeactivateMemberDialog', () => {
  afterEach(() => {
    cleanup()
    deactivateMember.mockReset()
  })

  it('deactivates by id with the csrf token, invalidates members, and closes', async () => {
    deactivateMember.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { onOpenChange, invalidateSpy } = renderDialog(member())

    await user.click(screen.getByRole('button', { name: en.deactivateConfirm }))

    await waitFor(() => expect(deactivateMember).toHaveBeenCalledTimes(1))
    expect(deactivateMember.mock.calls[0][0]).toBe('mem_1')
    expect(deactivateMember.mock.calls[0][1]).toBe('csrf-token')
    expect(deactivateMember.mock.calls[0][2]).toBe('op_1')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: TEAM_MEMBERS_QUERY_KEY })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces the last-owner refusal inline and keeps the dialog open', async () => {
    deactivateMember.mockRejectedValue(new ApiError('Cannot deactivate the last owner', 409))
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog(member({ role: 'OPERATOR_OWNER' }))

    await user.click(screen.getByRole('button', { name: en.deactivateConfirm }))

    expect(await screen.findByText('Cannot deactivate the last owner')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
