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
  resolveTeamOperatorId,
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

describe('resolveTeamOperatorId (#1230 slice 6)', () => {
  const owner: CallerContext = { userId: 'u', role: 'OPERATOR_OWNER', operatorId: 'op-self' }
  const admin: CallerContext = { userId: 'a', role: 'PLATFORM_ADMIN', bypassScope: true }

  test('returns an operator its own id and IGNORES a foreign input (no cross-tenant)', () => {
    expect(resolveTeamOperatorId(owner)).toBe('op-self')
    expect(resolveTeamOperatorId(owner, 'op-other')).toBe('op-self')
    // OPERATOR_STAFF follows the identical operator branch — pin it so removing
    // OPERATOR_STAFF from OPERATOR_ROLES would fail here, not silently pass.
    const staff: CallerContext = { userId: 'u', role: 'OPERATOR_STAFF', operatorId: 'op-self' }
    expect(resolveTeamOperatorId(staff)).toBe('op-self')
    expect(resolveTeamOperatorId(staff, 'op-other')).toBe('op-self')
  })

  test('fails closed for an operator that lost its operatorId claim', () => {
    const noOp: CallerContext = { userId: 'u', role: 'OPERATOR_STAFF' }
    expect(() => resolveTeamOperatorId(noOp, 'op-x')).toThrow(ForbiddenError)
  })

  test('returns the input id for a PLATFORM_ADMIN (honored ONLY here)', () => {
    expect(resolveTeamOperatorId(admin, 'op-target')).toBe('op-target')
  })

  test('throws OperatorRequiredError (422) for a PLATFORM_ADMIN with no pick — no merged team view', () => {
    expect(() => resolveTeamOperatorId(admin)).toThrow(OperatorRequiredError)
    expect(() => resolveTeamOperatorId(admin, '')).toThrow(OperatorRequiredError)
  })

  test('denies renter / partner / legacy STAFF·ADMIN outright (403) — team is owner-tier internal', () => {
    const renter: CallerContext = { userId: 'r', role: 'RENTER' }
    const partner: CallerContext = { userId: 't', role: 'PARTNER', bypassScope: true }
    const legacyStaff: CallerContext = { userId: 's', role: 'STAFF', bypassScope: false }
    const legacyAdmin: CallerContext = { userId: 'a2', role: 'ADMIN', bypassScope: false }
    for (const ctx of [renter, partner, legacyStaff, legacyAdmin]) {
      expect(() => resolveTeamOperatorId(ctx, 'op-target')).toThrow(ForbiddenError)
    }
  })
})
