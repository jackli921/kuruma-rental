import { beforeEach, describe, expect, it } from 'vitest'
import { PG_ERROR } from '../../src/pg-errors'
import { InMemoryProviderInviteRepository } from '../../src/repositories/in-memory'
import type { ProviderInvite } from '../../src/stores'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function inviteInput(overrides?: Partial<ProviderInvite>) {
  return {
    email: 'owner@example.com',
    operatorId: 'op_test',
    role: 'OPERATOR_OWNER' as const,
    tokenHash: 'hash_abc',
    status: 'PENDING' as const,
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    invitedByUserId: 'admin_1',
    acceptedByUserId: null,
    ...overrides,
  }
}

describe('InMemoryProviderInviteRepository', () => {
  let repo: InMemoryProviderInviteRepository

  beforeEach(() => {
    repo = new InMemoryProviderInviteRepository()
  })

  it('create assigns a UUID + timestamps and persists every field', async () => {
    const created = await repo.create(inviteInput())
    expect(created.id).toMatch(UUID_RE)
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(created.updatedAt).toBeInstanceOf(Date)
    expect(created.email).toBe('owner@example.com')
    expect(created.operatorId).toBe('op_test')
    expect(created.role).toBe('OPERATOR_OWNER')
    expect(created.tokenHash).toBe('hash_abc')
    expect(created.status).toBe('PENDING')
    expect(created.expiresAt).toEqual(new Date('2099-01-01T00:00:00Z'))
    expect(created.invitedByUserId).toBe('admin_1')
    expect(created.acceptedByUserId).toBeNull()
  })

  it('findByTokenHash returns the matching invite', async () => {
    const created = await repo.create(inviteInput({ tokenHash: 'h1' }))
    await repo.create(inviteInput({ tokenHash: 'h2', email: 'other@example.com' }))
    const found = await repo.findByTokenHash('h1')
    expect(found?.id).toBe(created.id)
    expect(found?.email).toBe('owner@example.com')
  })

  it('findByTokenHash returns undefined for an unknown hash', async () => {
    await repo.create(inviteInput({ tokenHash: 'h1' }))
    expect(await repo.findByTokenHash('nope')).toBeUndefined()
  })

  it('create rejects a duplicate tokenHash with UNIQUE_VIOLATION (mirrors the unique index)', async () => {
    await repo.create(inviteInput({ tokenHash: 'dup' }))
    await expect(
      repo.create(inviteInput({ tokenHash: 'dup', email: 'other@example.com' })),
    ).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
  })

  it('markAccepted consumes the invite: PENDING -> ACCEPTED, stamping the redeemer', async () => {
    const created = await repo.create(inviteInput({ tokenHash: 'h1' }))
    await repo.markAccepted(created.id, 'user_42')

    const found = await repo.findByTokenHash('h1')
    expect(found?.status).toBe('ACCEPTED')
    expect(found?.acceptedByUserId).toBe('user_42')
  })
})
