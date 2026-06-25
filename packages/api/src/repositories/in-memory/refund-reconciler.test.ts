import { describe, expect, it } from 'vitest'
import type { Booking, PaymentRefund } from '../../stores'
import { InMemoryRefundReconcilerRepository } from './refund-reconciler'

function booking(id: string, o: Partial<Booking> = {}): Booking {
  const now = new Date('2026-06-09T00:00:00Z')
  return {
    id,
    operatorId: 'op-1',
    renterId: 'renter-1',
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    fulfillmentMode: 'SPECIFIC',
    startAt: now,
    endAt: now,
    effectiveEndAt: now,
    status: 'CANCELLED',
    source: 'DIRECT',
    bookingCode: 'ABCD2345',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 100_000,
    cancellationFee: 30_000,
    cancellationFeeSettlement: 'REFUND_DUE',
    cancelledAt: now,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    createdAt: now,
    updatedAt: now,
    ...o,
  }
}

function receipt(bookingId: string, status: PaymentRefund['status']): PaymentRefund {
  const now = new Date('2026-06-09T00:00:00Z')
  return {
    id: `rf-${bookingId}`,
    bookingId,
    operatorId: 'op-1',
    stripePaymentIntentId: 'pi_1',
    amountJpy: 70_000,
    stripeRefundId: null,
    status,
    createdAt: now,
    updatedAt: now,
  }
}

function repo(bs: Booking[], rs: PaymentRefund[]) {
  const bookings = new Map(bs.map((b) => [b.id, b]))
  const refunds = new Map(rs.map((r) => [r.bookingId, r]))
  return new InMemoryRefundReconcilerRepository(bookings, refunds)
}

describe('InMemoryRefundReconcilerRepository.listRefundDueNeedingDrive', () => {
  it('returns a REFUND_DUE booking with NO receipt — the lost eager-fire self-heal case', async () => {
    const r = repo([booking('bk-1')], [])
    const due = await r.listRefundDueNeedingDrive({ limit: 10 })
    expect(due.map((b) => b.id)).toEqual(['bk-1'])
  })

  it('returns a REFUND_DUE booking whose receipt is still PENDING', async () => {
    const r = repo([booking('bk-1')], [receipt('bk-1', 'PENDING')])
    const due = await r.listRefundDueNeedingDrive({ limit: 10 })
    expect(due.map((b) => b.id)).toEqual(['bk-1'])
  })

  it('excludes a booking whose receipt is terminal (SUCCEEDED or FAILED)', async () => {
    const r = repo(
      [booking('done'), booking('stuck')],
      [receipt('done', 'SUCCEEDED'), receipt('stuck', 'FAILED')],
    )
    const due = await r.listRefundDueNeedingDrive({ limit: 10 })
    expect(due).toEqual([])
  })

  it('excludes bookings not in REFUND_DUE (ADVISORY/CAPTURED/REFUNDED)', async () => {
    const r = repo(
      [
        booking('advisory', { cancellationFeeSettlement: 'ADVISORY' }),
        booking('captured', { cancellationFeeSettlement: 'CAPTURED' }),
        booking('refunded', { cancellationFeeSettlement: 'REFUNDED' }),
      ],
      [],
    )
    expect(await r.listRefundDueNeedingDrive({ limit: 10 })).toEqual([])
  })

  it('drops terminal-FAILED rows BEFORE the limit so they cannot starve retryable work', async () => {
    // Two FAILED rows cancelled earliest (would sort first), then one retryable.
    const t = (h: number) => new Date(`2026-06-09T0${h}:00:00Z`)
    const r = repo(
      [
        booking('failed-a', { cancelledAt: t(1) }),
        booking('failed-b', { cancelledAt: t(2) }),
        booking('retryable', { cancelledAt: t(3) }),
      ],
      [receipt('failed-a', 'FAILED'), receipt('failed-b', 'FAILED')],
    )
    const due = await r.listRefundDueNeedingDrive({ limit: 1 })
    expect(due.map((b) => b.id)).toEqual(['retryable'])
  })

  it('respects the limit, oldest cancellation first', async () => {
    const t = (h: number) => new Date(`2026-06-09T0${h}:00:00Z`)
    const r = repo(
      [
        booking('newest', { cancelledAt: t(3) }),
        booking('oldest', { cancelledAt: t(1) }),
        booking('middle', { cancelledAt: t(2) }),
      ],
      [],
    )
    const due = await r.listRefundDueNeedingDrive({ limit: 2 })
    expect(due.map((b) => b.id)).toEqual(['oldest', 'middle'])
  })
})
