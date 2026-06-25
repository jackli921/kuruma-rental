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
//   2. A PARTNER (Trip.com) gets the SAME cross-operator rows — `GET /bookings` is
//      ungated (requireUser only) and scopes on `bypassScope`, which PARTNER
//      shares. So it is NOT platform-only (the gap tracked separately as #1119).
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

  it('PARTNER gets the SAME cross-operator rows — GET /bookings is NOT platform-only (#1119)', async () => {
    const res = await mountBookingsAs('PARTNER').request('/bookings')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    // PARTNER shares bypassScope (shared/auth/roles.ts SCOPE_BYPASS_ROLES), so it
    // reaches every tenant's bookings here. This is exactly why platform-owner
    // oversight cannot ride this endpoint — it needs requirePlatformAdmin.
    const operatorIds = new Set(data.map((b: { operatorId: string }) => b.operatorId))
    expect(operatorIds).toEqual(new Set([OP_A, OP_B]))
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
