import { describe, expect, it } from 'vitest'
import { CONSENT_CARDINALITY, CONSENT_DOC_STATUSES, CONSENT_METHODS, CONSENT_TYPES } from './enums'

describe('consent enums', () => {
  it('exposes the four consent document types', () => {
    expect(CONSENT_TYPES).toEqual([
      'RENTER_TOS',
      'PRIVACY_POLICY',
      'RENTER_LIABILITY',
      'OPERATOR_AGREEMENT',
    ])
  })

  it('document status is the DRAFT→PUBLISHED→ARCHIVED lifecycle', () => {
    expect(CONSENT_DOC_STATUSES).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  })

  it('acceptance methods are clickwrap, e-sign, imported', () => {
    expect(CONSENT_METHODS).toEqual(['CLICKWRAP', 'ESIGN', 'IMPORTED'])
  })

  it('maps liability to per-event and the rest to once-per-subject', () => {
    expect(CONSENT_CARDINALITY.RENTER_LIABILITY).toBe('PER_EVENT')
    expect(CONSENT_CARDINALITY.RENTER_TOS).toBe('ONCE_PER_SUBJECT')
    expect(CONSENT_CARDINALITY.PRIVACY_POLICY).toBe('ONCE_PER_SUBJECT')
    expect(CONSENT_CARDINALITY.OPERATOR_AGREEMENT).toBe('ONCE_PER_SUBJECT')
  })
})
