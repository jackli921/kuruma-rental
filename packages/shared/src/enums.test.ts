import { describe, expect, it } from 'vitest'
import {
  CONSENT_CARDINALITY,
  CONSENT_DOC_STATUSES,
  CONSENT_METHODS,
  CONSENT_TYPES,
  OPERATOR_APPLICATION_BUSINESS_TYPES,
  OPERATOR_APPLICATION_FLEET_SIZES,
  OPERATOR_APPLICATION_STATUSES,
  REVIEW_DIMENSIONS,
} from './enums'

describe('consent enums', () => {
  it('exposes all consent document types', () => {
    expect(CONSENT_TYPES).toEqual([
      'RENTER_TOS',
      'PRIVACY_POLICY',
      'RENTER_LIABILITY',
      'OPERATOR_AGREEMENT',
      'OPERATOR_RENTAL_TERMS',
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

describe('operator application enums', () => {
  it('pins application status order (ALTER TYPE ADD VALUE appends positionally)', () => {
    expect(OPERATOR_APPLICATION_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED'])
  })
  it('pins fleet-size buckets', () => {
    expect(OPERATOR_APPLICATION_FLEET_SIZES).toEqual(['1-5', '6-20', '21-50', '50+'])
  })
  it('pins business types', () => {
    expect(OPERATOR_APPLICATION_BUSINESS_TYPES).toEqual(['INDIVIDUAL', 'COMPANY'])
  })
})

describe('review enums', () => {
  it('pins the named sub-dimension key set (folded from validators/review.ts)', () => {
    expect(REVIEW_DIMENSIONS).toEqual([
      'cleanliness',
      'accuracy',
      'communication',
      'value',
      'ruleAdherence',
    ])
  })
})

describe('OPERATOR_RENTAL_TERMS consent type', () => {
  it('is a registered consent type', () => {
    expect(CONSENT_TYPES).toContain('OPERATOR_RENTAL_TERMS')
  })
  it('is per-event (accepted on every booking, like liability)', () => {
    expect(CONSENT_CARDINALITY.OPERATOR_RENTAL_TERMS).toBe('PER_EVENT')
  })
})
