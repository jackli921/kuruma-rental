import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { describe, expect, test } from 'vitest'
import { type CallerContext, ForbiddenError } from '../src/middleware/auth'
import { operatorReadScope, resolveOperatorIdForWrite } from '../src/tenancy'

const operatorCtx = (operatorId?: string): CallerContext =>
  operatorId !== undefined
    ? { userId: 'u', role: 'OPERATOR_OWNER', operatorId, bypassScope: false }
    : { userId: 'u', role: 'OPERATOR_OWNER', bypassScope: false }

const adminCtx: CallerContext = { userId: 'a', role: 'PLATFORM_ADMIN', bypassScope: true }
const legacyStaffCtx: CallerContext = { userId: 's', role: 'STAFF', bypassScope: true }
const renterCtx: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }

describe('operatorReadScope', () => {
  test('bypass roles see all', () => {
    expect(operatorReadScope(adminCtx)).toEqual({ kind: 'all' })
    expect(operatorReadScope(legacyStaffCtx)).toEqual({ kind: 'all' })
  })

  test('operator role is scoped to its operatorId', () => {
    expect(operatorReadScope(operatorCtx('op_1'))).toEqual({ kind: 'operator', operatorId: 'op_1' })
  })

  test('an OPERATOR_* caller without a tenant sees nothing (fail-closed)', () => {
    expect(operatorReadScope(operatorCtx())).toEqual({ kind: 'none' })
  })

  test('renters are not tenant-scoped — they browse the whole catalog', () => {
    expect(operatorReadScope(renterCtx)).toEqual({ kind: 'all' })
  })
})

describe('resolveOperatorIdForWrite', () => {
  test('operator role writes under its own ctx.operatorId', () => {
    expect(resolveOperatorIdForWrite(operatorCtx('op_7'))).toBe('op_7')
  })

  test('operator role with no operatorId fails closed', () => {
    expect(() => resolveOperatorIdForWrite(operatorCtx())).toThrow(ForbiddenError)
  })

  test('operator role ignores an input operatorId (cannot write for another tenant)', () => {
    expect(resolveOperatorIdForWrite(operatorCtx('op_7'), 'op_other')).toBe('op_7')
  })

  test('legacy/admin falls back to seeded Best Car Rental operator', () => {
    expect(resolveOperatorIdForWrite(legacyStaffCtx)).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
    expect(resolveOperatorIdForWrite(adminCtx)).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
  })

  test('legacy/admin honours an explicit input operatorId when given', () => {
    expect(resolveOperatorIdForWrite(adminCtx, 'op_explicit')).toBe('op_explicit')
  })
})
