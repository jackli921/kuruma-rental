import { describe, expect, it } from 'vitest'
import { consentEvidenceUrl, consentGovernanceResponseSchema } from './api'

const validRow = {
  acceptanceId: 'acc_1',
  userId: 'user_a',
  consentType: 'RENTER_TOS',
  version: '1.0',
  acceptedAt: '2026-03-01T00:00:00.000Z',
  operatorId: null,
  bookingId: null,
}

describe('consentGovernanceResponseSchema (network seam)', () => {
  it('accepts a well-formed ledger body', () => {
    const parsed = consentGovernanceResponseSchema.safeParse({ acceptances: [validRow] })
    expect(parsed.success).toBe(true)
  })

  it('rejects a drifted body where version arrived as a number', () => {
    const parsed = consentGovernanceResponseSchema.safeParse({
      acceptances: [{ ...validRow, version: 1 }],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an out-of-domain consentType (anchored to the enum SSoT)', () => {
    const parsed = consentGovernanceResponseSchema.safeParse({
      acceptances: [{ ...validRow, consentType: 'NONSENSE' }],
    })
    expect(parsed.success).toBe(false)
  })
})

describe('consentEvidenceUrl', () => {
  it('links to the existing per-acceptance evidence export, id percent-encoded', () => {
    expect(consentEvidenceUrl('acc 1/x')).toMatch(
      /\/admin\/consent\/acceptances\/acc%201%2Fx\/evidence$/,
    )
  })
})
