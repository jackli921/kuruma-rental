import { beforeEach, describe, expect, it } from 'vitest'
import type { ProviderInvite } from '../../stores'
import { InMemoryProviderInviteRepository } from './provider-invite'

const baseInvite = (
  overrides: Partial<Omit<ProviderInvite, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Omit<ProviderInvite, 'id' | 'createdAt' | 'updatedAt'> => ({
  email: 'alice@example.com',
  operatorId: 'op-1',
  role: 'OPERATOR_OWNER',
  tokenHash: crypto.randomUUID(),
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 86_400_000),
  invitedByUserId: 'user-admin',
  acceptedByUserId: null,
  ...overrides,
})

describe('InMemoryProviderInviteRepository.findPendingByEmail', () => {
  let store: Map<string, ProviderInvite>
  let repo: InMemoryProviderInviteRepository

  beforeEach(() => {
    store = new Map()
    repo = new InMemoryProviderInviteRepository(store)
  })

  it('returns the PENDING invite for a matching email', async () => {
    const created = await repo.create(baseInvite({ email: 'alice@example.com' }))
    const found = await repo.findPendingByEmail('alice@example.com')
    expect(found?.id).toBe(created.id)
  })

  it('is case-insensitive', async () => {
    const created = await repo.create(baseInvite({ email: 'alice@example.com' }))
    const found = await repo.findPendingByEmail('ALICE@EXAMPLE.COM')
    expect(found?.id).toBe(created.id)
  })

  it('returns undefined when the only invite for that email is REVOKED', async () => {
    const created = await repo.create(
      baseInvite({ email: 'bob@example.com', operatorId: 'op-2', tokenHash: crypto.randomUUID() }),
    )
    await repo.revoke(created.id, 'op-2')
    const found = await repo.findPendingByEmail('bob@example.com')
    expect(found).toBeUndefined()
  })

  it('returns undefined when the only invite for that email is ACCEPTED', async () => {
    const created = await repo.create(
      baseInvite({ email: 'erin@example.com', operatorId: 'op-3', tokenHash: crypto.randomUUID() }),
    )
    await repo.markAccepted(created.id, 'user-erin')
    const found = await repo.findPendingByEmail('erin@example.com')
    expect(found).toBeUndefined()
  })

  it('returns undefined for an unknown email', async () => {
    await repo.create(baseInvite({ email: 'carol@example.com', tokenHash: crypto.randomUUID() }))
    const found = await repo.findPendingByEmail('nobody@example.com')
    expect(found).toBeUndefined()
  })

  it('finds a PENDING invite across a different operator than another PENDING invite', async () => {
    // Two operators each invite a different email; only one matches.
    await repo.create(
      baseInvite({
        email: 'alice@example.com',
        operatorId: 'op-1',
        tokenHash: crypto.randomUUID(),
      }),
    )
    const op2Invite = await repo.create(
      baseInvite({ email: 'dave@example.com', operatorId: 'op-2', tokenHash: crypto.randomUUID() }),
    )
    const found = await repo.findPendingByEmail('dave@example.com')
    expect(found?.id).toBe(op2Invite.id)
  })
})
