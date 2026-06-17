import { TeamView } from '@/vite/operator-team/TeamView'
import type { OperatorInviteData, OperatorMemberData } from '@kuruma/shared/types/operator-team'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

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

function renderView(props: Partial<Parameters<typeof TeamView>[0]> = {}) {
  const onRevokeInvite = vi.fn()
  const onDeactivateMember = vi.fn()
  render(
    <IntlProvider locale="en" messages={enMessages}>
      <TeamView
        members={[member()]}
        invites={[invite()]}
        canManage={false}
        onRevokeInvite={onRevokeInvite}
        onDeactivateMember={onDeactivateMember}
        {...props}
      />
    </IntlProvider>,
  )
  return { onRevokeInvite, onDeactivateMember }
}

describe('TeamView row actions', () => {
  afterEach(cleanup)

  it('renders no manage buttons when canManage is false', () => {
    renderView({ canManage: false })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('revokes the clicked invite when canManage is true', async () => {
    const user = userEvent.setup()
    const inv = invite({ id: 'inv_9', email: 'pick@example.com' })
    const { onRevokeInvite } = renderView({ canManage: true, invites: [inv] })

    await user.click(screen.getByRole('button', { name: /Revoke invite for pick@example.com/ }))

    expect(onRevokeInvite).toHaveBeenCalledTimes(1)
    expect(onRevokeInvite).toHaveBeenCalledWith(inv)
  })

  it('deactivates the clicked member when canManage is true', async () => {
    const user = userEvent.setup()
    const mem = member({ id: 'mem_9', name: 'Kenji Sato' })
    const { onDeactivateMember } = renderView({ canManage: true, members: [mem] })

    await user.click(screen.getByRole('button', { name: /Deactivate Kenji Sato/ }))

    expect(onDeactivateMember).toHaveBeenCalledTimes(1)
    expect(onDeactivateMember).toHaveBeenCalledWith(mem)
  })
})
