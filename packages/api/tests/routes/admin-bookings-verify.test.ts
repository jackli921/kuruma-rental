import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import type { RunInTransaction } from '../../src/repositories/types'
import { createBookingRoutes } from '../../src/routes/bookings'
import { BookingService } from '../../src/services/booking'
import type { Booking } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'
import { makeInertConsentGate } from '../helpers/consent'

// #1092 STEP 1 — VERIFY-FIRST. The slice decision (#1092 "✅ Decisions") is to
// BUILD a dedicated `GET /admin/bookings`. This test is the recorded evidence for
// WHY the existing `GET /bookings` cannot carry the platform-owner oversight page.
// It establishes three code-grounded facts:
//   1. A PLATFORM_ADMIN's `GET /bookings` DOES already return cross-operator rows
//      (>=2 distinct operatorId) — cross-operator READ is not the gap.
//   2. A PARTNER (Trip.com) is now scoped to its OWN channel (source=TRIP_COM)
//      and no longer reads operators' DIRECT bookings — the cross-tenant leak
//      closed in #1119. Either way `GET /bookings` is not platform-only: it
//      serves renters/operators/partners by scope, so the oversight page still
//      needs a dedicated platform-gated `GET /admin/bookings`.
//   3. The raw row carries `operatorId` but NOT operator identity (name) nor any
//      customer (renter name/email) — an oversight table cannot say WHICH operator
//      or WHO booked. Plus it offers no operator/bookingCode/customer filters.
// VERDICT: build `GET /admin/bookings` (platform-gated) with an admin DTO that
// includes operator + customer identity and the oversight filters.

const OP_A = '00000000-0000-4000-8000-00000000a001'
const OP_B = '00000000-0000-4000-8000-00000000b001'

const noopTx: RunInTransaction = (async () => {
  throw new Error('transactions are not exercised by the GET /bookings read path')
}) as unknown as RunInTransaction

function fullBooking(overrides: Partial<Booking>): Booking {
  const base = bookingInput(overrides)
  return {
    ...base,
    id: crypto.randomUUID(),
    cancellationFeeSettlement: 'ADVISORY',
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  }
}

function mountBookingsAs(role: UserRole) {
  const store = new Map<string, Booking>()
  for (const b of [
    fullBooking({ operatorId: OP_A, assignedVehicleId: 'veh-a', requestedVehicleId: 'veh-a' }),
    fullBooking({ operatorId: OP_B, assignedVehicleId: 'veh-b', requestedVehicleId: 'veh-b' }),
    // A Trip.com-sourced booking (on OP_A) — the only row a PARTNER may read (#1119).
    fullBooking({
      operatorId: OP_A,
      source: 'TRIP_COM',
      assignedVehicleId: 'veh-c',
      requestedVehicleId: 'veh-c',
    }),
  ]) {
    store.set(b.id, b)
  }
  const bookingRepo = new InMemoryBookingRepository(store)
  const service = new BookingService(bookingRepo, noopTx)
  const app = new Hono()
  app.use('*', testAuthMiddleware(`${role}-user`, role))
  app.route('/', createBookingRoutes(service, makeInertConsentGate()))
  return app
}

describe('#1092 verify-first: GET /bookings cross-operator behaviour', () => {
  it('PLATFORM_ADMIN sees rows from >=2 distinct operators (cross-operator read already works)', async () => {
    const res = await mountBookingsAs('PLATFORM_ADMIN').request('/bookings')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    const operatorIds = new Set(data.map((b: { operatorId: string }) => b.operatorId))
    expect(operatorIds).toEqual(new Set([OP_A, OP_B]))
  })

  it('PARTNER reads ONLY its own channel (source=TRIP_COM), not operators DIRECT rows (#1119)', async () => {
    const res = await mountBookingsAs('PARTNER').request('/bookings')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    // #1119: PARTNER no longer rides bypassScope for bookings — it reads only the
    // bookings it sourced. The operators' DIRECT rows (OP_A/OP_B) are invisible;
    // only the TRIP_COM row (seeded on OP_A) comes back.
    expect(data.map((b: { source: string }) => b.source)).toEqual(['TRIP_COM'])
    const operatorIds = new Set(data.map((b: { operatorId: string }) => b.operatorId))
    expect(operatorIds).toEqual(new Set([OP_A]))
  })

  it('the raw row carries operatorId but NO operator name or customer identity (the DTO gap)', async () => {
    const res = await mountBookingsAs('PLATFORM_ADMIN').request('/bookings')
    const { data } = await res.json()
    const [row] = data as Array<Record<string, unknown>>
    // operatorId is present at the API level (the web bookingDtoSchema strips it)...
    expect(typeof row.operatorId).toBe('string')
    // ...but there is no operator display name and no renter identity, so an
    // oversight table cannot show WHICH operator or WHO booked.
    expect('operator' in row).toBe(false)
    expect('operatorName' in row).toBe(false)
    expect('renter' in row).toBe(false)
  })
})
