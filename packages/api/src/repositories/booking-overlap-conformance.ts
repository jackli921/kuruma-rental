import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../middleware/auth'
import {
  BOOKING_CODE_CONSTRAINT,
  IDEMPOTENCY_CONSTRAINT,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../pg-errors'
import type { Booking } from '../stores'
import type { BookingRepository } from './types'

// #1106: cross-impl behavioural conformance for the seals that BookingService
// branches on by Postgres error code + constraint name. The existing
// composition/repositories.test.ts only pins the *key set* of the repo bundles;
// it never asserts the two impls *behave* identically on a clash. This file is
// the shared body — InMemory and Drizzle callers each wire their own setup +
// cleanup and run the same scenarios. The float scenario is the H1 regression
// guard: with the bug reintroduced, the InMemory arm fails on the first `it`
// while the Drizzle arm passes — proving the suite catches the divergence.

export type ConformanceIds = {
  operatorId: string
  classId: string
  locationId: string
  // A SPECIFIC vehicle to key the non-null exclusion on. Both inserts in the
  // non-null overlap scenario share this id so Postgres's gist `&&` overlap
  // fires (and the InMemory mirror takes the same branch).
  vehicleId: string
  renterId: string
}

export type ConformanceContext = {
  repo: BookingRepository
  ids: ConformanceIds
  cleanup: () => Promise<void>
}

export type ConformanceOptions = {
  adapterName: string
  setup: () => Promise<ConformanceContext>
}

// Far-future window that can never collide with any seeded demo bookings.
const WINDOW_START = new Date('2027-10-01T09:00:00Z')
const WINDOW_END = new Date('2027-10-01T17:00:00Z')

type CreateInput = Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'>

function baseInput(ids: ConformanceIds, overrides: Partial<CreateInput>): CreateInput {
  return {
    operatorId: ids.operatorId,
    renterId: ids.renterId,
    classId: ids.classId,
    // The default below is SPECIFIC, which the DB seals with the
    // `bookings_specific_requires_requested` CHECK — both ids must be set.
    // The CLASS_COMBO scenarios override `fulfillmentMode` + both vehicle ids
    // to null in their `baseInput(..., { ... })` calls.
    requestedVehicleId: ids.vehicleId,
    assignedVehicleId: ids.vehicleId,
    pickupLocationId: ids.locationId,
    dropoffLocationId: ids.locationId,
    startAt: WINDOW_START,
    endAt: WINDOW_END,
    effectiveEndAt: WINDOW_END,
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'CFM-BASE',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 30_000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    ...overrides,
  }
}

export function describeBookingOverlapConformance(opts: ConformanceOptions): void {
  describe(`BookingRepository conformance — ${opts.adapterName}`, () => {
    let ctx: ConformanceContext

    beforeEach(async () => {
      ctx = await opts.setup()
    })

    afterEach(async () => {
      await ctx.cleanup()
    })

    // #1105: the H1 regression. Postgres's `EXCLUDE USING gist
    // ("assignedVehicleId" WITH =, tstzrange &&)` never conflicts on a NULL
    // key — two overlapping CLASS_COMBO floats both insert. The InMemory mirror
    // used `!== continue` which inverts NULL-exclusion (null !== null is false →
    // falls through, then overlaps → spurious EXCLUSION_VIOLATION).
    it('two overlapping CLASS_COMBO floats (assignedVehicleId=null) both insert', async () => {
      await ctx.repo.create(
        SYSTEM_CONTEXT,
        baseInput(ctx.ids, {
          bookingCode: 'CFM-FLOAT-1',
          assignedVehicleId: null,
          requestedVehicleId: null,
          fulfillmentMode: 'CLASS_COMBO',
        }),
      )
      await ctx.repo.create(
        SYSTEM_CONTEXT,
        baseInput(ctx.ids, {
          bookingCode: 'CFM-FLOAT-2',
          assignedVehicleId: null,
          requestedVehicleId: null,
          fulfillmentMode: 'CLASS_COMBO',
        }),
      )
    })

    // Preserves the real double-booking guard: two SPECIFIC bookings on the
    // same vehicle with overlapping ranges must still raise EXCLUSION_VIOLATION
    // (constraint name `bookings_no_overlap`).
    it('two overlapping SPECIFIC bookings on the same vehicle raise EXCLUSION_VIOLATION', async () => {
      await ctx.repo.create(SYSTEM_CONTEXT, baseInput(ctx.ids, { bookingCode: 'CFM-SPEC-1' }))

      let caught: unknown
      try {
        await ctx.repo.create(SYSTEM_CONTEXT, baseInput(ctx.ids, { bookingCode: 'CFM-SPEC-2' }))
      } catch (err) {
        caught = err
      }

      expect(caught).toBeDefined()
      expect(pgErrorCode(caught)).toBe(PG_ERROR.EXCLUSION_VIOLATION)
      expect(pgConstraintName(caught)).toBe('bookings_no_overlap')
    })

    it('duplicate bookingCode raises UNIQUE_VIOLATION with BOOKING_CODE_CONSTRAINT name', async () => {
      await ctx.repo.create(SYSTEM_CONTEXT, baseInput(ctx.ids, { bookingCode: 'CFM-DUP-CODE' }))

      let caught: unknown
      try {
        await ctx.repo.create(
          SYSTEM_CONTEXT,
          baseInput(ctx.ids, {
            bookingCode: 'CFM-DUP-CODE',
            // Distinct window so the exclusion seal cannot win the race for
            // the error name — we want the bookingCode unique to fire.
            startAt: new Date('2027-11-01T09:00:00Z'),
            endAt: new Date('2027-11-01T17:00:00Z'),
            effectiveEndAt: new Date('2027-11-01T17:00:00Z'),
          }),
        )
      } catch (err) {
        caught = err
      }

      expect(caught).toBeDefined()
      expect(pgErrorCode(caught)).toBe(PG_ERROR.UNIQUE_VIOLATION)
      expect(pgConstraintName(caught)).toBe(BOOKING_CODE_CONSTRAINT)
    })

    it('duplicate idempotencyKey raises UNIQUE_VIOLATION with IDEMPOTENCY_CONSTRAINT name', async () => {
      await ctx.repo.create(
        SYSTEM_CONTEXT,
        baseInput(ctx.ids, {
          bookingCode: 'CFM-IDK-1',
          idempotencyKey: 'idk-conformance',
        }),
      )

      let caught: unknown
      try {
        await ctx.repo.create(
          SYSTEM_CONTEXT,
          baseInput(ctx.ids, {
            bookingCode: 'CFM-IDK-2',
            idempotencyKey: 'idk-conformance',
            startAt: new Date('2027-12-01T09:00:00Z'),
            endAt: new Date('2027-12-01T17:00:00Z'),
            effectiveEndAt: new Date('2027-12-01T17:00:00Z'),
          }),
        )
      } catch (err) {
        caught = err
      }

      expect(caught).toBeDefined()
      expect(pgErrorCode(caught)).toBe(PG_ERROR.UNIQUE_VIOLATION)
      expect(pgConstraintName(caught)).toBe(IDEMPOTENCY_CONSTRAINT)
    })
  })
}
