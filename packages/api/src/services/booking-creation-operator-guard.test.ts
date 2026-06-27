import { describe, expect, test } from 'vitest'
import type { TransactionRepos } from '../repositories/types'
import { rejectIfOperatorDeactivated } from './booking-creation-operator-guard'

// The guard only reads `operatorRepo.findById`; stub the rest of the bundle.
const reposReturning = (operator: { deactivatedAt: Date | null } | undefined): TransactionRepos =>
  ({ operatorRepo: { findById: async () => operator } }) as unknown as TransactionRepos

const REJECTION = {
  ok: false,
  status: 409,
  error: 'Operator is not accepting new bookings',
  code: 'OPERATOR_DEACTIVATED',
}

describe('rejectIfOperatorDeactivated (#1206)', () => {
  test('returns null for an active operator (deactivatedAt null)', async () => {
    const result = await rejectIfOperatorDeactivated(
      reposReturning({ deactivatedAt: null }),
      'op_active',
    )
    expect(result).toBeNull()
  })

  test('rejects 409 OPERATOR_DEACTIVATED when deactivatedAt is set', async () => {
    const result = await rejectIfOperatorDeactivated(
      reposReturning({ deactivatedAt: new Date('2026-01-01T00:00:00Z') }),
      'op_off',
    )
    expect(result).toEqual(REJECTION)
  })

  test('rejects 409 when the operator is missing (defence in depth — FK makes this unreachable in prod)', async () => {
    const result = await rejectIfOperatorDeactivated(reposReturning(undefined), 'op_gone')
    expect(result).toEqual(REJECTION)
  })
})
