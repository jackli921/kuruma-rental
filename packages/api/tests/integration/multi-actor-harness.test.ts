import { BEST_CAR_RENTAL_OPERATOR_ID, SECOND_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { afterAll, describe, expect, it } from 'vitest'
import { DrizzleBookingRepository } from '../../src/repositories/drizzle'
import { operatorCtx } from '../helpers/context'
import { createSeededBooking } from './booking-factory'
import { db } from './setup'

// #654 (Slice 2 of #652): prove the multi-actor real-DB harness foundation.
//  (1) the booking-via-service factory creates a booking precondition WITHOUT UI
//      clicks — the helper S3/S4 journeys import.
//  (2) the SECOND seeded tenant is a real, distinct operator, so cross-tenant
//      isolation is asserted at the integration layer (near-free via `ctxFor`,
//      the issue's preferred path over a second Playwright browser).
const bookingRepo = new DrizzleBookingRepository(db)

describe('multi-actor harness: booking factory + second tenant (real pg)', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
  })

  it('factory seeds a booking owned by tenant 1, invisible to tenant 2', async () => {
    const seeded = await createSeededBooking({ operatorId: BEST_CAR_RENTAL_OPERATOR_ID })
    cleanups.push(seeded.cleanup)

    expect(seeded.booking.operatorId).toBe(BEST_CAR_RENTAL_OPERATOR_ID)

    const ownView = await bookingRepo.findById(
      operatorCtx(BEST_CAR_RENTAL_OPERATOR_ID),
      seeded.booking.id,
    )
    expect(ownView?.id).toBe(seeded.booking.id)

    const foreignView = await bookingRepo.findById(
      operatorCtx(SECOND_OPERATOR_ID),
      seeded.booking.id,
    )
    expect(foreignView).toBeUndefined()
  })

  it('factory seeds a booking for the SECOND tenant (deterministic 2nd operator)', async () => {
    const seeded = await createSeededBooking({ operatorId: SECOND_OPERATOR_ID })
    cleanups.push(seeded.cleanup)

    expect(seeded.booking.operatorId).toBe(SECOND_OPERATOR_ID)

    const ownView = await bookingRepo.findById(operatorCtx(SECOND_OPERATOR_ID), seeded.booking.id)
    expect(ownView?.id).toBe(seeded.booking.id)

    const foreignView = await bookingRepo.findById(
      operatorCtx(BEST_CAR_RENTAL_OPERATOR_ID),
      seeded.booking.id,
    )
    expect(foreignView).toBeUndefined()
  })

  it('factory composes insurance + add-on into the service-computed total', async () => {
    const DAILY_RATE = 8000
    const INSURANCE_DAILY = 2000
    const ADD_ON_PRICE = 1500
    const RENTAL_DAYS = 2
    const seeded = await createSeededBooking({
      dailyRateJpy: DAILY_RATE,
      withInsurance: true,
      insuranceDailyJpy: INSURANCE_DAILY,
      withAddOn: true,
      addOnPriceJpy: ADD_ON_PRICE,
      startAt: new Date('2027-02-01T09:00:00Z'),
      endAt: new Date('2027-02-03T09:00:00Z'),
    })
    cleanups.push(seeded.cleanup)

    // base (8000*2) + insurance/day (2000*2) + add-on flat (1500) = 21500.
    expect(seeded.booking.totalPrice).toBe(
      DAILY_RATE * RENTAL_DAYS + INSURANCE_DAILY * RENTAL_DAYS + ADD_ON_PRICE,
    )
  })
})
