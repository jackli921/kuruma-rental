import { describe, expect, it } from 'vitest'
import {
  PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT,
  PAYMENT_EVENT_SESSION_CONSTRAINT,
  PAYMENT_EVENT_STRIPE_EVENT_CONSTRAINT,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../../pg-errors'
import type { NewPaymentEvent } from '../types'
import { InMemoryPaymentEventRepository } from './payment-event'

function newEvent(overrides: Partial<NewPaymentEvent> = {}): NewPaymentEvent {
  return {
    operatorId: 'op-1',
    bookingId: 'bk-1',
    stripeEventId: 'evt_1',
    stripeCheckoutSessionId: 'cs_1',
    stripePaymentIntentId: 'pi_1',
    grossJpy: 100_000,
    platformFeeJpy: 4_000,
    netToPartnerJpy: 96_000,
    currency: 'jpy',
    status: 'SUCCEEDED',
    ...overrides,
  }
}

describe('InMemoryPaymentEventRepository', () => {
  it('persists a row and assigns id + createdAt', async () => {
    const repo = new InMemoryPaymentEventRepository()
    const saved = await repo.insert(newEvent())
    expect(saved.id).toMatch(/[0-9a-f-]{36}/)
    expect(saved.createdAt).toBeInstanceOf(Date)
    expect(saved.grossJpy).toBe(100_000)
    expect(saved.operatorId).toBe('op-1')
  })

  it('finds the succeeded payment for a booking, null before any', async () => {
    const repo = new InMemoryPaymentEventRepository()
    expect(await repo.findSucceededByBookingId('bk-1')).toBeNull()
    await repo.insert(newEvent())
    const found = await repo.findSucceededByBookingId('bk-1')
    expect(found?.stripeCheckoutSessionId).toBe('cs_1')
  })

  it('rejects a redelivered event id (idempotency fence)', async () => {
    const repo = new InMemoryPaymentEventRepository()
    await repo.insert(newEvent())
    const err = await repo
      .insert(newEvent({ bookingId: 'bk-2', stripeCheckoutSessionId: 'cs_2' }))
      .catch((e) => e)
    expect(pgErrorCode(err)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(err)).toBe(PAYMENT_EVENT_STRIPE_EVENT_CONSTRAINT)
  })

  it('rejects a duplicate checkout session id', async () => {
    const repo = new InMemoryPaymentEventRepository()
    await repo.insert(newEvent())
    const err = await repo
      .insert(newEvent({ bookingId: 'bk-2', stripeEventId: 'evt_2' }))
      .catch((e) => e)
    expect(pgConstraintName(err)).toBe(PAYMENT_EVENT_SESSION_CONSTRAINT)
  })

  it('rejects a SECOND successful payment for the same booking (business-fact seal)', async () => {
    const repo = new InMemoryPaymentEventRepository()
    await repo.insert(newEvent())
    // A wholly different Stripe event + session, but the same booking.
    const err = await repo
      .insert(newEvent({ stripeEventId: 'evt_2', stripeCheckoutSessionId: 'cs_2' }))
      .catch((e) => e)
    expect(pgConstraintName(err)).toBe(PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT)
  })
})
