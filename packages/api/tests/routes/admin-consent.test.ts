import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryConsentRepository } from '../../src/repositories/in-memory/consent'
import { createAdminConsentRoutes } from '../../src/routes/admin-consent'
import { ConsentGovernanceService } from '../../src/services/consent-governance'
import type { ConsentDocument } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

function doc(id: string, version: string, type: ConsentDocument['type']): ConsentDocument {
  return {
    id,
    type,
    version,
    locale: 'en',
    title: 'Terms',
    body: 'body',
    acceptanceLabel: 'I accept',
    contentHash: 'a'.repeat(64),
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

const TOS_V1 = doc('doc_tos_v1_en', '1.0', 'RENTER_TOS')
const TOS_V2 = doc('doc_tos_v2_en', '2.0', 'RENTER_TOS')

async function seededRepo(): Promise<InMemoryConsentRepository> {
  const repo = new InMemoryConsentRepository([TOS_V1, TOS_V2])
  await repo.createAcceptance({
    documentId: TOS_V1.id,
    consentType: 'RENTER_TOS',
    userId: 'user_a',
    operatorId: null,
    operatorMembershipId: null,
    actorRole: 'RENTER',
    bookingId: null,
    acceptedAt: new Date('2026-03-01T00:00:00Z'),
    context: null,
    ipAddress: null,
    userAgent: null,
    method: 'CLICKWRAP',
    recordSignature: null,
    signingKeyId: null,
    signatureCanonicalVersion: null,
    documentSnapshot: null,
  })
  await repo.createAcceptance({
    documentId: TOS_V2.id,
    consentType: 'RENTER_TOS',
    userId: 'user_b',
    operatorId: null,
    operatorMembershipId: null,
    actorRole: 'RENTER',
    bookingId: null,
    acceptedAt: new Date('2026-05-01T00:00:00Z'),
    context: null,
    ipAddress: null,
    userAgent: null,
    method: 'CLICKWRAP',
    recordSignature: null,
    signingKeyId: null,
    signatureCanonicalVersion: null,
    documentSnapshot: null,
  })
  return repo
}

async function mount(role: UserRole, operatorId?: string) {
  const repo = await seededRepo()
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createAdminConsentRoutes(new ConsentGovernanceService(repo)))
  return app
}

describe('GET /admin/consent/acceptances — auth', () => {
  it('401 when unauthenticated', async () => {
    const repo = await seededRepo()
    const app = new Hono()
    app.route('/', createAdminConsentRoutes(new ConsentGovernanceService(repo)))
    expect((await app.request('/admin/consent/acceptances')).status).toBe(401)
  })

  it.each(['RENTER', 'PARTNER', 'STAFF', 'ADMIN', 'OPERATOR_STAFF'] as const)(
    '403 for %s (not a platform admin)',
    async (role) => {
      const app = await mount(role)
      expect((await app.request('/admin/consent/acceptances')).status).toBe(403)
    },
  )

  it('403 for an OPERATOR_OWNER (must never browse the cross-tenant ledger)', async () => {
    const app = await mount('OPERATOR_OWNER', 'operator-aaaa')
    expect((await app.request('/admin/consent/acceptances')).status).toBe(403)
  })

  it('200 for PLATFORM_ADMIN', async () => {
    const app = await mount('PLATFORM_ADMIN')
    expect((await app.request('/admin/consent/acceptances')).status).toBe(200)
  })
})

describe('GET /admin/consent/acceptances — browse + filter', () => {
  it('returns acceptances across users, newest first, with no status field', async () => {
    const app = await mount('PLATFORM_ADMIN')
    const res = await app.request('/admin/consent/acceptances')
    const { data } = await res.json()
    expect(data.acceptances.map((a: { userId: string }) => a.userId)).toEqual(['user_b', 'user_a'])
    expect(data.acceptances[0]).toMatchObject({
      userId: 'user_b',
      consentType: 'RENTER_TOS',
      version: '2.0',
      acceptedAt: '2026-05-01T00:00:00.000Z',
    })
    expect(data.acceptances[0]).not.toHaveProperty('status')
  })

  it('narrows by ?consentType + ?version query params (not the self-scoped narrowing)', async () => {
    const app = await mount('PLATFORM_ADMIN')
    const res = await app.request('/admin/consent/acceptances?consentType=RENTER_TOS&version=1.0')
    const { data } = await res.json()
    expect(data.acceptances).toHaveLength(1)
    expect(data.acceptances[0]).toMatchObject({ userId: 'user_a', version: '1.0' })
  })

  it('400 for an out-of-domain consentType', async () => {
    const app = await mount('PLATFORM_ADMIN')
    const res = await app.request('/admin/consent/acceptances?consentType=NONSENSE')
    expect(res.status).toBe(400)
  })
})
