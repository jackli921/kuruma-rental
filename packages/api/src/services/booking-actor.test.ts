import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../middleware/auth'
import { resolveBookingActor } from './booking-actor'

// #1108 (audit M4): actor resolution — "who books, with what source, and is it a
// walk-in" — is domain authz, not a route concern. These tests pin it as a pure
// function callable with a plain ctx + request, no Hono Context. They assert the
// EXACT prior route behavior (bookings.ts:159-164) so the extraction is a no-op
// end-to-end.

const ctx = (role: CallerContext['role'], userId: string): CallerContext => ({
  userId,
  role,
  bypassScope: false,
})

const WALK_IN = { name: 'Aiko Tanaka', phone: '+81-90-0000-0000' }

describe('resolveBookingActor — renter (self-serve)', () => {
  it('books as the caller, forces source=DIRECT, ignores a supplied renterId', () => {
    const actor = resolveBookingActor(ctx('RENTER', 'renter-1'), {
      renterId: 'someone-else',
      source: 'MANUAL',
    })
    expect(actor).toEqual({ renterId: 'renter-1', source: 'DIRECT' })
  })

  it('drops a walk-in customer a renter is not allowed to register', () => {
    const actor = resolveBookingActor(ctx('RENTER', 'renter-1'), {
      source: 'DIRECT',
      walkInCustomer: WALK_IN,
    })
    expect(actor).toEqual({ renterId: 'renter-1', source: 'DIRECT' })
    expect(actor.walkInCustomer).toBeUndefined()
  })

  it('forces source=DIRECT for a PARTNER (api-key) caller too — only manual bookers keep source', () => {
    const actor = resolveBookingActor(ctx('PARTNER', 'partner-key'), {
      source: 'TRIP_COM',
      renterId: 'whoever',
    })
    expect(actor).toEqual({ renterId: 'partner-key', source: 'DIRECT' })
  })
})

describe('resolveBookingActor — manual booker (operator / platform-admin)', () => {
  it('an operator books on behalf of a target renterId with source=MANUAL', () => {
    const actor = resolveBookingActor(ctx('OPERATOR_OWNER', 'op-staff'), {
      renterId: 'customer-7',
      source: 'MANUAL',
    })
    expect(actor).toEqual({ renterId: 'customer-7', source: 'MANUAL' })
  })

  it('a platform-admin is a manual booker (STAFF_ROLES) and keeps source + renterId', () => {
    const actor = resolveBookingActor(ctx('PLATFORM_ADMIN', 'admin-1'), {
      renterId: 'customer-7',
      source: 'MANUAL',
    })
    expect(actor).toEqual({ renterId: 'customer-7', source: 'MANUAL' })
  })

  it('passes a walk-in customer through and falls back to the caller id when no renterId given', () => {
    const actor = resolveBookingActor(ctx('OPERATOR_STAFF', 'op-staff'), {
      source: 'MANUAL',
      walkInCustomer: WALK_IN,
    })
    expect(actor).toEqual({ renterId: 'op-staff', source: 'MANUAL', walkInCustomer: WALK_IN })
  })

  it('falls back to the caller id when a manual booker omits renterId and has no walk-in', () => {
    const actor = resolveBookingActor(ctx('OPERATOR_OWNER', 'op-staff'), { source: 'MANUAL' })
    expect(actor).toEqual({ renterId: 'op-staff', source: 'MANUAL' })
  })
})
