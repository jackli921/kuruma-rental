import { describe, expect, test } from 'vitest'
import { type CallerContext, ForbiddenError, OperatorRequiredError } from '../src/middleware/auth'
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
  test('operator role writes under its own ctx.operatorId', async () => {
    await expect(resolveOperatorIdForWrite(operatorCtx('op_7'), undefined)).resolves.toBe('op_7')
  })

  test('operator role with no operatorId fails closed', async () => {
    await expect(resolveOperatorIdForWrite(operatorCtx(), undefined)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  test('operator role ignores an input operatorId (cannot write for another tenant)', async () => {
    await expect(resolveOperatorIdForWrite(operatorCtx('op_7'), 'op_other')).resolves.toBe('op_7')
  })

  test('non-operator honours an explicit input operatorId', async () => {
    await expect(resolveOperatorIdForWrite(adminCtx, 'op_explicit')).resolves.toBe('op_explicit')
  })

  // #407: sole-operator inference is retired — a non-operator write must name its
  // target operator explicitly, even while exactly one operator exists. This
  // closes the read-then-write TOCTOU and stops silent misattribution once a
  // second operator is onboarded.
  test('non-operator with no operatorId is always rejected (inference retired #407)', async () => {
    await expect(resolveOperatorIdForWrite(adminCtx, undefined)).rejects.toBeInstanceOf(
      OperatorRequiredError,
    )
    await expect(resolveOperatorIdForWrite(legacyStaffCtx, undefined)).rejects.toBeInstanceOf(
      OperatorRequiredError,
    )
  })
})
