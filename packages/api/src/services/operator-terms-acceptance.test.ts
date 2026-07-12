import { describe, expect, it } from 'vitest'
import type { ConsentDocument } from '../stores'
import { resolveOperatorTermsDecision } from './operator-terms-acceptance'

// A published OPERATOR_RENTAL_TERMS document fixture. The resolver only cares
// whether a doc is present + the (latest, pinned) version strings; it returns the
// doc verbatim on `accept`, so a full-shape fixture keeps the assertions precise.
function makeDoc(overrides: Partial<ConsentDocument> = {}): ConsentDocument {
  return {
    id: 'doc-v3-ja',
    type: 'OPERATOR_RENTAL_TERMS',
    version: 'v3',
    locale: 'ja',
    operatorId: 'op-1',
    title: '利用規約',
    body: '本文',
    acceptanceLabel: '同意する',
    contentHash: 'a'.repeat(64),
    status: 'PUBLISHED',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('resolveOperatorTermsDecision', () => {
  const doc = makeDoc()

  it('skips when the caller is not a self-serve renter (excludes walk-in/manual/PARTNER)', () => {
    expect(
      resolveOperatorTermsDecision({
        role: 'OPERATOR_ADMIN',
        latest: 'v3',
        doc,
        accepted: true,
        pinned: 'v3',
      }),
    ).toEqual({ kind: 'skip' })
  })

  it('skips when the operator has no published+effective terms', () => {
    expect(
      resolveOperatorTermsDecision({
        role: 'RENTER',
        latest: undefined,
        doc: undefined,
        accepted: false,
        pinned: undefined,
      }),
    ).toEqual({ kind: 'skip' })
  })

  it('requires acceptance when a published doc exists but the renter did not accept', () => {
    expect(
      resolveOperatorTermsDecision({
        role: 'RENTER',
        latest: 'v3',
        doc,
        accepted: false,
        pinned: undefined,
      }),
    ).toEqual({ kind: 'required' })
  })

  it('rejects as changed when the pinned version is not the latest (exact-string)', () => {
    expect(
      resolveOperatorTermsDecision({
        role: 'RENTER',
        latest: 'v4',
        doc: makeDoc({ version: 'v4' }),
        accepted: true,
        pinned: 'v3',
      }),
    ).toEqual({ kind: 'changed' })
  })

  it('accepts and returns the exact pinned doc when pinned equals latest', () => {
    expect(
      resolveOperatorTermsDecision({
        role: 'RENTER',
        latest: 'v3',
        doc,
        accepted: true,
        pinned: 'v3',
      }),
    ).toEqual({ kind: 'accept', doc })
  })
})
