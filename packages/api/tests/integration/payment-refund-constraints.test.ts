import { paymentRefunds } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PG_ERROR, pgConstraintName, pgErrorCode } from '../../src/pg-errors'
import { type SeededBooking, createSeededBooking } from './booking-factory'
import { db } from './setup'

// #1068 (follow-up to #1056 MEDIUM 1): payment_refunds.amountJpy is the ledger
// column the refund webhook/reconciler write. The service guards it, but every
// other money column in this schema carries a DB-level *_non_negative CHECK; this
// proves the DB rejects a negative amount too. Inserts DIRECTLY via db.insert (NOT
// a repo) so the Postgres-emitted constraint name is what we assert — a migration
// that renames or drops the seal turns this green test red.

let seeded: SeededBooking
let bookingId: string
let operatorId: string

beforeAll(async () => {
  seeded = await createSeededBooking({ prefix: 'refund-check' })
  bookingId = seeded.booking.id
  operatorId = seeded.operatorId
})

afterEach(async () => {
  // The payment_refunds_bookingId_unique seal allows one row per booking; clear it
  // between cases so each starts from a clean slate and the CHECK is what trips.
  await db.delete(paymentRefunds).where(eq(paymentRefunds.bookingId, bookingId))
})

afterAll(async () => {
  await db.delete(paymentRefunds).where(eq(paymentRefunds.bookingId, bookingId))
  await seeded.cleanup()
})

function refundRow(amountJpy: number): typeof paymentRefunds.$inferInsert {
  return {
    id: crypto.randomUUID(),
    bookingId,
    operatorId,
    stripePaymentIntentId: `pi_${crypto.randomUUID().slice(0, 12)}`,
    amountJpy,
  }
}

async function insertRefund(amountJpy: number): Promise<unknown> {
  return db
    .insert(paymentRefunds)
    .values(refundRow(amountJpy))
    .then(
      () => null,
      (e) => e,
    )
}

describe('payment_refunds.amountJpy non-negative CHECK (#1068, real pg)', () => {
  it('accepts a positive refund amount', async () => {
    expect(await insertRefund(70_000), 'a positive amount must insert').toBeNull()
  })

  it('accepts a zero refund amount (>= 0 boundary)', async () => {
    expect(await insertRefund(0), 'zero is on the inclusive boundary and must insert').toBeNull()
  })

  it('rejects a negative refund amount with the payment_refunds_amount_non_negative CHECK', async () => {
    const err = await insertRefund(-1)
    expect(
      err,
      'a negative amountJpy must be rejected by the DB, not silently stored',
    ).not.toBeNull()
    expect(pgErrorCode(err)).toBe(PG_ERROR.CHECK_VIOLATION)
    expect(pgConstraintName(err)).toBe('payment_refunds_amount_non_negative')
  })
})
