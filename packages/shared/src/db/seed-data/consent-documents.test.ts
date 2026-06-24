import { describe, expect, it } from 'vitest'
import { computeContentHash } from '../../lib/consent-canonical'
import { DEMO_CONSENT_DOCUMENTS } from './consent-documents'

describe('DEMO_CONSENT_DOCUMENTS', () => {
  it('has 4 types × 3 locales = 12 PUBLISHED rows', () => {
    expect(DEMO_CONSENT_DOCUMENTS).toHaveLength(12)
    expect(DEMO_CONSENT_DOCUMENTS.every((d) => d.status === 'PUBLISHED')).toBe(true)
  })

  it('covers all 4 types in each of en/ja/zh exactly once', () => {
    for (const locale of ['en', 'ja', 'zh'] as const) {
      const types = DEMO_CONSENT_DOCUMENTS.filter((d) => d.locale === locale).map((d) => d.type)
      expect(new Set(types)).toEqual(
        new Set(['RENTER_TOS', 'PRIVACY_POLICY', 'RENTER_LIABILITY', 'OPERATOR_AGREEMENT']),
      )
      expect(types).toHaveLength(4)
    }
  })

  it('stores a contentHash consistent with its disclosure (title, body, acceptanceLabel)', () => {
    for (const d of DEMO_CONSENT_DOCUMENTS) {
      expect(d.contentHash).toBe(
        computeContentHash({ title: d.title, body: d.body, acceptanceLabel: d.acceptanceLabel }),
      )
    }
  })

  it('keeps the RENTER_LIABILITY body verbatim from the booking i18n (Phase 4 backfill parity)', () => {
    const en = DEMO_CONSENT_DOCUMENTS.find(
      (d) => d.type === 'RENTER_LIABILITY' && d.locale === 'en',
    )
    expect(en?.version).toBe('2026-06-13')
    expect(en?.body).toContain('verification is completed in person at pickup')
  })

  it('seeds documents that are PUBLISHED and effective as of the seed date (service-acceptable)', () => {
    const asOf = new Date('2026-06-15T00:00:00Z')
    for (const d of DEMO_CONSENT_DOCUMENTS) {
      expect(d.status).toBe('PUBLISHED')
      expect(d.effectiveFrom.getTime()).toBeLessThanOrEqual(asOf.getTime())
    }
  })
})
