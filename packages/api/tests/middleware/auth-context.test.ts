import { describe, expect, test } from 'vitest'
import {
  type AuthUser,
  type CallerContext,
  ForbiddenError,
  rejectOperatorContextUntilScoped,
  requireOperatorScope,
  SYSTEM_CONTEXT,
  toCallerContext,
} from '../../src/middleware/auth'

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return { id: 'user_1', role: 'RENTER', ...overrides }
}

describe('toCallerContext', () => {
  test('OPERATOR_OWNER carries operatorId and does NOT bypass scope', () => {
    const ctx = toCallerContext(authUser({ role: 'OPERATOR_OWNER', operatorId: 'op_1' }))
    expect(ctx).toEqual({
      userId: 'user_1',
      role: 'OPERATOR_OWNER',
      operatorId: 'op_1',
      bypassScope: false,
    })
  })

  test('OPERATOR_STAFF carries operatorId and does NOT bypass scope', () => {
    const ctx = toCallerContext(authUser({ role: 'OPERATOR_STAFF', operatorId: 'op_2' }))
    expect(ctx.operatorId).toBe('op_2')
    expect(ctx.bypassScope).toBe(false)
  })

  test('PLATFORM_ADMIN bypasses scope with no operatorId', () => {
    const ctx = toCallerContext(authUser({ role: 'PLATFORM_ADMIN' }))
    expect(ctx.bypassScope).toBe(true)
    expect(ctx.operatorId).toBeUndefined()
  })

  test('legacy ADMIN bypasses scope (temporary platform-admin per §6.2)', () => {
    const ctx = toCallerContext(authUser({ role: 'ADMIN' }))
    expect(ctx.bypassScope).toBe(true)
    expect(ctx.operatorId).toBeUndefined()
  })

  test('legacy STAFF bypasses scope (temporary platform-admin per §6.2)', () => {
    const ctx = toCallerContext(authUser({ role: 'STAFF' }))
    expect(ctx.bypassScope).toBe(true)
  })

  test('PARTNER (3rd-party API caller) bypasses scope', () => {
    const ctx = toCallerContext(authUser({ id: 'partner:api-key', role: 'PARTNER' }))
    expect(ctx.bypassScope).toBe(true)
  })

  test('RENTER does NOT bypass scope and has no operatorId', () => {
    const ctx = toCallerContext(authUser({ role: 'RENTER' }))
    expect(ctx.bypassScope).toBe(false)
    expect(ctx.operatorId).toBeUndefined()
  })
})

describe('SYSTEM_CONTEXT', () => {
  test('is a scope-bypassing PLATFORM_ADMIN', () => {
    expect(SYSTEM_CONTEXT.role).toBe('PLATFORM_ADMIN')
    expect(SYSTEM_CONTEXT.bypassScope).toBe(true)
  })
})

describe('requireOperatorScope', () => {
  test('passes for OPERATOR_OWNER with operatorId', () => {
    const ctx: CallerContext = {
      userId: 'u',
      role: 'OPERATOR_OWNER',
      operatorId: 'op_1',
      bypassScope: false,
    }
    expect(() => requireOperatorScope(ctx)).not.toThrow()
  })

  test('throws ForbiddenError for OPERATOR_OWNER missing operatorId', () => {
    const ctx: CallerContext = { userId: 'u', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(() => requireOperatorScope(ctx)).toThrow(ForbiddenError)
    expect(() => requireOperatorScope(ctx)).toThrow('operator scope required')
  })

  test('throws for OPERATOR_STAFF missing operatorId', () => {
    const ctx: CallerContext = { userId: 'u', role: 'OPERATOR_STAFF', bypassScope: false }
    expect(() => requireOperatorScope(ctx)).toThrow(ForbiddenError)
  })

  test('passes for PLATFORM_ADMIN (no operatorId needed)', () => {
    expect(() => requireOperatorScope(SYSTEM_CONTEXT)).not.toThrow()
  })
})

describe('rejectOperatorContextUntilScoped', () => {
  test('throws ForbiddenError naming the repo for OPERATOR_OWNER', () => {
    const ctx: CallerContext = {
      userId: 'u',
      role: 'OPERATOR_OWNER',
      operatorId: 'op_1',
      bypassScope: false,
    }
    expect(() => rejectOperatorContextUntilScoped(ctx, 'BookingRepository')).toThrow(ForbiddenError)
    expect(() => rejectOperatorContextUntilScoped(ctx, 'BookingRepository')).toThrow(
      'BookingRepository not yet operator-scoped',
    )
  })

  test('throws for OPERATOR_STAFF', () => {
    const ctx: CallerContext = {
      userId: 'u',
      role: 'OPERATOR_STAFF',
      operatorId: 'op_1',
      bypassScope: false,
    }
    expect(() => rejectOperatorContextUntilScoped(ctx, 'MessageRepository')).toThrow(ForbiddenError)
  })

  test('does NOT throw for legacy ADMIN (transition bypass preserved)', () => {
    const ctx = toCallerContext(authUser({ role: 'ADMIN' }))
    expect(() => rejectOperatorContextUntilScoped(ctx, 'BookingRepository')).not.toThrow()
  })

  test('does NOT throw for RENTER (renter paths unaffected)', () => {
    const ctx = toCallerContext(authUser({ role: 'RENTER' }))
    expect(() => rejectOperatorContextUntilScoped(ctx, 'BookingRepository')).not.toThrow()
  })

  test('does NOT throw for PLATFORM_ADMIN', () => {
    expect(() => rejectOperatorContextUntilScoped(SYSTEM_CONTEXT, 'BookingRepository')).not.toThrow()
  })
})
