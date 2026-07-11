import { describe, expect, test } from 'vitest'

import { ERROR_CODES } from './error-codes'

/**
 * Contract test for the single source of truth (#941). `ERROR_CODES` pins the
 * exact set of envelope failure codes the API emits and the web discriminates
 * on. Producers append `satisfies ErrorCode` at each emit site (compile-time);
 * this test pins the membership so a code can't be silently dropped — which
 * would break web discrimination with no compile error on the consumer side.
 */
describe('ERROR_CODES', () => {
  test('is the exhaustive set of envelope failure codes the API emits', () => {
    expect([...ERROR_CODES].sort()).toEqual([
      'BLOCK_BOOKING_CONFLICT',
      'CLASS_COMBO_SOLD_OUT',
      'CLASS_HAS_ACTIVE_BOOKINGS',
      'CONSENT_REQUIRED',
      'DOCUMENT_VERIFICATION_REQUIRED',
      'INVALID_DURATION',
      'INVALID_STATUS',
      'INVALID_VEHICLE_CLASS',
      'LOCATION_HAS_ACTIVE_BOOKINGS',
      'NOT_A_COMBO',
      'NOT_IMPLEMENTED',
      'NO_COMBO_RATE_SET',
      'NO_RATES_SET',
      'OPERATOR_DEACTIVATED',
      'OPERATOR_REQUIRED',
      'OPERATOR_TERMS_CHANGED',
      'OPERATOR_TERMS_REQUIRED',
      'RENTAL_RULE_ADVANCE_BOOKING',
      'RENTAL_RULE_MAX_DURATION',
      'RENTAL_RULE_MIN_DURATION',
      'RENTAL_RULE_START_IN_PAST',
      'USE_ASSIGN_FOR_COMBO',
      'VEHICLE_BLOCKED',
      'VEHICLE_BLOCK_OVERLAP',
      'VEHICLE_DOCS_EXPIRE_BEFORE_RETURN',
      'VEHICLE_UNAVAILABLE',
    ])
  })

  test('contains no duplicate codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})
