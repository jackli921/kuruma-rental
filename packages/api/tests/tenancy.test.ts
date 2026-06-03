import { describe, expect, test } from 'vitest'
import { type CallerContext, ForbiddenError, OperatorRequiredError } from '../src/middleware/auth'
import { type OperatorLookup, operatorReadScope, resolveOperatorIdForWrite } from '../src/tenancy'

const lookupReturning = (soleId: string | null): OperatorLookup => ({
  findSoleId: async () => soleId,
})
const lookupNeverCalled: OperatorLookup = {
  findSoleId: async () => {
    throw new Error(
      'findSoleId must not be called for operator-scoped or explicit-operatorId writes',
    )
  },
}

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
  test('operator role writes under its own ctx.operatorId', async () => {
    await expect(
      resolveOperatorIdForWrite(operatorCtx('op_7'), undefined, lookupNeverCalled),
    ).resolves.toBe('op_7')
  })

  test('operator role with no operatorId fails closed', async () => {
    await expect(
      resolveOperatorIdForWrite(operatorCtx(), undefined, lookupNeverCalled),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  test('operator role ignores an input operatorId (cannot write for another tenant)', async () => {
    await expect(
      resolveOperatorIdForWrite(operatorCtx('op_7'), 'op_other', lookupNeverCalled),
    ).resolves.toBe('op_7')
  })

  test('non-operator honours an explicit input operatorId without consulting the lookup', async () => {
    await expect(
      resolveOperatorIdForWrite(adminCtx, 'op_explicit', lookupNeverCalled),
    ).resolves.toBe('op_explicit')
  })

  test('non-operator with no input infers the sole operator (no BCR hardcode)', async () => {
    await expect(
      resolveOperatorIdForWrite(legacyStaffCtx, undefined, lookupReturning('op_only')),
    ).resolves.toBe('op_only')
  })

  test('non-operator with no input is rejected when zero or 2+ operators exist', async () => {
    await expect(
      resolveOperatorIdForWrite(adminCtx, undefined, lookupReturning(null)),
    ).rejects.toBeInstanceOf(OperatorRequiredError)
  })
})
