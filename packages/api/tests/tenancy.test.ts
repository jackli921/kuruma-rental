import { describe, expect, test } from 'vitest'
import {
  type CallerContext,
  ForbiddenError,
  OperatorRequiredError,
  ScopeRequiredError,
} from '../src/middleware/auth'
import {
  applyCrossOperatorReadScope,
  operatorReadScope,
  resolveOperatorIdForWrite,
} from '../src/tenancy'

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

describe('applyCrossOperatorReadScope', () => {
  // Operator/none/renter scopes are decided at the repo (operators auto-scope to
  // their tenant; a tenant-less operator fails closed), so the helper passes
  // their filters through untouched — it only adjudicates the `all`-scope read.
  test('operator-scoped caller passes filters through unchanged', () => {
    expect(
      applyCrossOperatorReadScope(operatorCtx('op_1'), { includeAll: false }, { status: 'ACTIVE' }),
    ).toEqual({ status: 'ACTIVE' })
  })

  test('tenant-less operator (none) passes through — the repo fails it closed', () => {
    expect(applyCrossOperatorReadScope(operatorCtx(), { includeAll: false }, {})).toEqual({})
  })

  // The defence-in-depth core: an `all`-scope caller that named neither a target
  // operator nor includeAll must be rejected, never silently served every tenant.
  test('all-scope with neither operatorId nor includeAll throws ScopeRequiredError', () => {
    expect(() => applyCrossOperatorReadScope(adminCtx, { includeAll: false }, {})).toThrow(
      ScopeRequiredError,
    )
    expect(() => applyCrossOperatorReadScope(legacyStaffCtx, { includeAll: false }, {})).toThrow(
      ScopeRequiredError,
    )
  })

  test('all-scope with an explicit operatorId stamps it onto the filters', () => {
    expect(
      applyCrossOperatorReadScope(
        adminCtx,
        { operatorId: 'op_9', includeAll: false },
        { status: 'ACTIVE' },
      ),
    ).toEqual({ status: 'ACTIVE', operatorId: 'op_9' })
  })

  test('all-scope with includeAll and no operatorId reads across every tenant (unfiltered)', () => {
    expect(
      applyCrossOperatorReadScope(adminCtx, { includeAll: true }, { status: 'ACTIVE' }),
    ).toEqual({
      status: 'ACTIVE',
    })
  })

  test('an explicit operatorId wins over includeAll', () => {
    expect(
      applyCrossOperatorReadScope(adminCtx, { operatorId: 'op_9', includeAll: true }, {}),
    ).toEqual({ operatorId: 'op_9' })
  })
})
