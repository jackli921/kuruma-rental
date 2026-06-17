import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryConsentRepository } from '../repositories/in-memory/consent'
import type { ConsentRepository } from '../repositories/types'
import type { ConsentDocument } from '../stores'
import { ConsentService } from './consent'

const KEY = { key: 'test-secret', keyId: 'v1' }
function doc(over: Partial<ConsentDocument> = {}): ConsentDocument {
  return {
    id: 'doc_tos_v1_en',
    type: 'RENTER_TOS',
    version: '1.0',
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
    ...over,
  }
}
const NOW = new Date('2026-06-15T00:00:00Z')

describe('ConsentService.recordAcceptance', () => {
  let repo: InMemoryConsentRepository
  let svc: ConsentService
  beforeEach(() => {
    repo = new InMemoryConsentRepository([doc()])
    svc = new ConsentService(repo, () => KEY)
  })

  it('signs and persists a renter ToS acceptance', async () => {
    const r = await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW, ipAddress: '203.0.113.7', userAgent: 'jest' },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.acceptance.consentType).toBe('RENTER_TOS')
    expect(r.acceptance.recordSignature).toMatch(/^[0-9a-f]{64}$/)
    expect(r.acceptance.signingKeyId).toBe('v1')
    expect(r.acceptance.acceptedAt).toEqual(NOW)
  })

  it('rejects a DRAFT document with NOT_ACCEPTABLE', async () => {
    repo = new InMemoryConsentRepository([doc({ status: 'DRAFT' })])
    svc = new ConsentService(repo, () => KEY)
    const r = await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    expect(r).toMatchObject({ ok: false, status: 409, error: 'DOCUMENT_NOT_ACCEPTABLE' })
  })

  it('rejects an unknown document with 404', async () => {
    const r = await svc.recordAcceptance(
      { documentId: 'nope', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it('is idempotent — a retry returns the existing row, not a duplicate', async () => {
    const input = { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' as const }
    const first = await svc.recordAcceptance(input, { now: NOW })
    const second = await svc.recordAcceptance(input, { now: new Date('2026-06-16Z') })
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(second.acceptance.id).toBe(first.acceptance.id)
  })
})

describe('ConsentService.recordAcceptance — subject-shape validation', () => {
  it('rejects RENTER_LIABILITY accepted without a bookingId → SUBJECT_SHAPE_INVALID', async () => {
    const repo = new InMemoryConsentRepository([
      doc({ id: 'doc_lia_v1_en', type: 'RENTER_LIABILITY' }),
    ])
    const svc = new ConsentService(repo, () => KEY)
    const r = await svc.recordAcceptance(
      { documentId: 'doc_lia_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    expect(r).toMatchObject({ ok: false, status: 400, error: 'SUBJECT_SHAPE_INVALID' })
  })

  it('rejects RENTER_TOS accepted with a spurious bookingId → SUBJECT_SHAPE_INVALID', async () => {
    const repo = new InMemoryConsentRepository([doc()])
    const svc = new ConsentService(repo, () => KEY)
    const r = await svc.recordAcceptance(
      {
        documentId: 'doc_tos_v1_en',
        userId: 'user_1',
        actorRole: 'RENTER',
        bookingId: 'booking_spurious',
      },
      { now: NOW },
    )
    expect(r).toMatchObject({ ok: false, status: 400, error: 'SUBJECT_SHAPE_INVALID' })
  })
})

describe('ConsentService.recordAcceptance — concurrent-race catch path', () => {
  it('recovers when pre-check misses but insert hits unique constraint (TOCTOU race)', async () => {
    // Seed the real repo with an existing accepted row so createAcceptance will throw.
    const realRepo = new InMemoryConsentRepository([doc()])
    const seeded = await realRepo.createAcceptance({
      documentId: 'doc_tos_v1_en',
      consentType: 'RENTER_TOS',
      userId: 'user_race',
      operatorId: null,
      operatorMembershipId: null,
      actorRole: 'RENTER',
      bookingId: null,
      acceptedAt: NOW,
      context: null,
      ipAddress: null,
      userAgent: null,
      method: 'CLICKWRAP',
      recordSignature: null,
      signingKeyId: null,
    })

    // Wrap the repo so the FIRST findUserDocumentAcceptance call returns undefined
    // (simulating the pre-check racing past the insert window), while all subsequent
    // calls and every other method delegate to the real repo.
    let firstLookup = true
    const wrappedRepo: ConsentRepository = {
      findDocumentById: (...args) => realRepo.findDocumentById(...args),
      findLatestPublishedVersion: (...args) => realRepo.findLatestPublishedVersion(...args),
      findPublishedDocument: (...args) => realRepo.findPublishedDocument(...args),
      hasAcceptedVersion: (...args) => realRepo.hasAcceptedVersion(...args),
      findUserDocumentAcceptance: (...args) => {
        if (firstLookup) {
          firstLookup = false
          return Promise.resolve(undefined) // simulate race miss
        }
        return realRepo.findUserDocumentAcceptance(...args) // catch re-fetch finds the row
      },
      findBookingAcceptance: (...args) => realRepo.findBookingAcceptance(...args),
      findOperatorDocumentAcceptance: (...args) => realRepo.findOperatorDocumentAcceptance(...args),
      createAcceptance: (...args) => realRepo.createAcceptance(...args),
    }

    const svc = new ConsentService(wrappedRepo, () => KEY)
    const r = await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_race', actorRole: 'RENTER' },
      { now: NOW },
    )
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(r.acceptance.id).toBe(seeded.id)
  })
})

describe('ConsentService re-consent query (renter)', () => {
  it('reports missing types and flips to current after acceptance', async () => {
    const repo = new InMemoryConsentRepository([
      doc(),
      doc({ id: 'doc_priv_v1_en', type: 'PRIVACY_POLICY', title: 'Privacy' }),
    ])
    const svc = new ConsentService(repo, () => KEY)
    expect(await svc.getRequiredReconsents('user_1', 'RENTER', NOW)).toEqual([
      'RENTER_TOS',
      'PRIVACY_POLICY',
    ])
    await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    await svc.recordAcceptance(
      { documentId: 'doc_priv_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    expect(await svc.getRequiredReconsents('user_1', 'RENTER', NOW)).toEqual([])
    expect(await svc.isCurrent('user_1', 'RENTER', NOW)).toBe(true)
  })

  it('flags non-current the moment a newer version publishes in ANY single locale (§7 cohort-first)', async () => {
    const repo = new InMemoryConsentRepository([
      doc(), // RENTER_TOS 1.0 en
      doc({ id: 'doc_tos_v2_ja', version: '2.0', locale: 'ja' }), // newest cohort, ja-only
    ])
    const svc = new ConsentService(repo, () => KEY)
    await svc.recordAcceptance(
      { documentId: 'doc_tos_v1_en', userId: 'user_1', actorRole: 'RENTER' },
      { now: NOW },
    )
    // accepted 1.0 only; latest TOS cohort is now 2.0 (ja) → still required. PRIVACY unpublished → skipped.
    expect(await svc.getRequiredReconsents('user_1', 'RENTER', NOW)).toEqual(['RENTER_TOS'])
  })
})
