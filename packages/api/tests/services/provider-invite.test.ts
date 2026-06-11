import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryProviderInviteRepository } from '../../src/repositories/in-memory/provider-invite'
import {
  INVITE_TTL_MS,
  type ProviderInviteAuditEvent,
  ProviderInviteService,
} from '../../src/services/provider-invite'

const WEB_BASE = 'https://app.example.com'
const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex')

const INPUT = { email: 'invitee@example.com', operatorId: 'op_1', role: 'OPERATOR_OWNER' } as const
const INVITED_BY = 'user_admin'

let repo: InMemoryProviderInviteRepository
let audits: ProviderInviteAuditEvent[]
let service: ProviderInviteService

beforeEach(() => {
  repo = new InMemoryProviderInviteRepository()
  audits = []
  service = new ProviderInviteService(repo, { webBaseUrl: WEB_BASE }, (e) => audits.push(e))
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
})
