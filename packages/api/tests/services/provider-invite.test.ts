import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError } from '../../src/auth/guards'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryProviderInviteRepository } from '../../src/repositories/in-memory/provider-invite'
import {
  INVITE_TTL_MS,
  OperatorNotFoundError,
  type ProviderInviteAuditEvent,
  ProviderInviteService,
} from '../../src/services/provider-invite'
import type { Operator } from '../../src/stores'

const WEB_BASE = 'https://app.example.com'
const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex')

const INPUT = { email: 'invitee@example.com', operatorId: 'op_1', role: 'OPERATOR_OWNER' } as const
const INVITED_BY = 'user_admin'

const OPERATOR: Operator = {
  id: 'op_1',
  slug: 'pilot',
  name: 'Pilot Operator',
  preAuthHandoffUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

let repo: InMemoryProviderInviteRepository
let operatorRepo: InMemoryOperatorRepository
let audits: ProviderInviteAuditEvent[]
let service: ProviderInviteService

beforeEach(() => {
  repo = new InMemoryProviderInviteRepository()
  operatorRepo = new InMemoryOperatorRepository(new Map([[OPERATOR.id, OPERATOR]]))
  audits = []
  service = new ProviderInviteService(repo, operatorRepo, { webBaseUrl: WEB_BASE }, (e) =>
    audits.push(e),
  )
})

describe('ProviderInviteService.createInvite', () => {
  it('persists only the sha256 hash of the token — never the plaintext — as a PENDING invite', async () => {
    const result = await service.createInvite(INPUT, INVITED_BY)

    // The plaintext token is returned to the caller once...
    expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/)
    // ...but the row is keyed by its hash; a lookup BY the plaintext finds nothing.
    expect(await repo.findByTokenHash(result.token)).toBeUndefined()

    const stored = await repo.findByTokenHash(sha256Hex(result.token))
    expect(stored).toBeDefined()
    expect(stored?.tokenHash).toBe(sha256Hex(result.token))
    expect(stored?.status).toBe('PENDING')
    expect(stored?.email).toBe('invitee@example.com')
    expect(stored?.operatorId).toBe('op_1')
    expect(stored?.role).toBe('OPERATOR_OWNER')
    expect(stored?.invitedByUserId).toBe(INVITED_BY)
    expect(stored?.acceptedByUserId).toBeNull()
  })

  it('builds the invite URL from the web base and the one-time plaintext token', async () => {
    const result = await service.createInvite(INPUT, INVITED_BY)
    expect(result.inviteUrl).toBe(`${WEB_BASE}/provider/invite/${result.token}`)
  })

  it('expires the invite after the configured TTL', async () => {
    const before = Date.now()
    const result = await service.createInvite({ ...INPUT }, INVITED_BY)
    const after = Date.now()
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + INVITE_TTL_MS)
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + INVITE_TTL_MS)
  })

  it('throws OperatorNotFoundError for an unknown operatorId, before any write or audit', async () => {
    await expect(
      service.createInvite({ ...INPUT, operatorId: 'op_missing' }, INVITED_BY),
    ).rejects.toThrow(OperatorNotFoundError)
    // The guard runs before the insert + audit — no partial side effects leak out.
    expect(audits).toEqual([])
  })

  it('emits a privilege-grant audit event that does not leak the token', async () => {
    const result = await service.createInvite(INPUT, INVITED_BY)
    expect(audits).toEqual([
      {
        type: 'PROVIDER_INVITE_CREATED',
        invitedByUserId: INVITED_BY,
        operatorId: 'op_1',
        email: 'invitee@example.com',
      },
    ])
    expect(JSON.stringify(audits)).not.toContain(result.token)
  })

  // #904 slice 2: the partial-unique index (mirrored in-memory) makes a second
  // PENDING invite for the same operator+email a 23505; createInvite translates it
  // to a ConflictError the route maps to 409 — not a raw 500.
  it('throws ConflictError when a PENDING invite for the same operator+email exists', async () => {
    await service.createInvite(INPUT, INVITED_BY)
    await expect(service.createInvite(INPUT, INVITED_BY)).rejects.toThrow(ConflictError)
    // The failed mint adds no second row and emits no audit for the rejected attempt.
    expect(await repo.listByOperator('op_1')).toHaveLength(1)
    expect(audits).toHaveLength(1)
  })

  it('OperatorNotFoundError is a NotFoundError so the global handler maps it to 404, not 500 (c1)', () => {
    const err = new OperatorNotFoundError('op_missing')
    expect(err).toBeInstanceOf(NotFoundError)
    expect(err.operatorId).toBe('op_missing')
  })

  it('lets the same email be re-invited once the prior invite is revoked', async () => {
    const first = await service.createInvite(INPUT, INVITED_BY)
    const stored = await repo.findByTokenHash(sha256Hex(first.token))
    await repo.revoke(stored?.id ?? '', 'op_1')

    const second = await service.createInvite(INPUT, INVITED_BY)
    expect(second.token).not.toBe(first.token)
    expect(await repo.listByOperator('op_1')).toHaveLength(1)
  })
})

describe('ProviderInviteService.preview', () => {
  const TOKEN = 'plain-token-abcdef'
  const seed = (over: Partial<Parameters<typeof repo.create>[0]> = {}) =>
    repo.create({
      email: 'invitee@example.com',
      operatorId: OPERATOR.id,
      role: 'OPERATOR_OWNER',
      tokenHash: sha256Hex(TOKEN),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedByUserId: INVITED_BY,
      acceptedByUserId: null,
      ...over,
    })

  it('returns the operator name + expiry and valid:true for a live PENDING invite — never the email', async () => {
    const invite = await seed()

    const preview = await service.preview(TOKEN)

    expect(preview).toEqual({
      valid: true,
      operatorName: 'Pilot Operator',
      expiresAt: invite.expiresAt,
    })
    // A leaked invite URL must not disclose the target address (#521 §7).
    expect(preview).not.toHaveProperty('email')
    expect(JSON.stringify(preview)).not.toContain('invitee@example.com')
  })

  it('returns valid:false with no operator details for an unknown token', async () => {
    const preview = await service.preview('never-issued')
    expect(preview).toEqual({ valid: false })
  })

  it('returns valid:false for an expired invite, still naming the operator', async () => {
    const invite = await seed({ expiresAt: new Date(Date.now() - 1000) })

    const preview = await service.preview(TOKEN)

    expect(preview).toEqual({
      valid: false,
      operatorName: 'Pilot Operator',
      expiresAt: invite.expiresAt,
    })
  })

  it('returns valid:false for an already-accepted invite', async () => {
    await seed({ status: 'ACCEPTED', acceptedByUserId: 'user_redeemer' })

    const preview = await service.preview(TOKEN)

    expect(preview.valid).toBe(false)
    expect(preview.operatorName).toBe('Pilot Operator')
  })
})
