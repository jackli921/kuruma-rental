import type { Booking } from '../../src/stores'

// cancellationFeeSettlement is server-derived (#868 3a) — omitted from create
// input, so fixtures never set it; the repo stamps the 'ADVISORY' default.
type NewBooking = Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'>

// Process-unique prefix (random per vitest worker) so parallel integration test
// files sharing one Postgres branch never collide on the bookingCode UNIQUE
// constraint; the per-call sequence guarantees uniqueness within a worker.
const CODE_PREFIX = `T${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
let codeSeq = 0
/**
 * Unique reservation code per call. `bookings.bookingCode` is NOT NULL UNIQUE
 * (#392), so fixtures that don't care about the code itself must still avoid
 * collisions on the in-memory unique mirror AND the real DB across parallel
 * workers. Uppercase base36 keeps it readable and within [0-9A-Z].
 */
export function nextBookingCode(): string {
  codeSeq += 1
  return `${CODE_PREFIX}${codeSeq.toString(36).toUpperCase().padStart(4, '0')}`
}

/**
 * Build a marketplace-shape booking input (#392) with sane defaults. Callers
 * override only the fields their assertion cares about. `assignedVehicleId`
 * defaults to `requestedVehicleId` (and vice-versa) so a fixture that names one
 * vehicle gets a consistent pair; `effectiveEndAt` defaults to `endAt` (no
 * turnaround) — pass it explicitly when a test exercises the turnaround window.
 */
export function bookingInput(overrides: Partial<NewBooking> = {}): NewBooking {
  const vehicleId = overrides.assignedVehicleId ?? overrides.requestedVehicleId ?? 'veh-1'
  const endAt = overrides.endAt ?? new Date('2026-04-10T17:00:00Z')
  return {
    operatorId: 'op-1',
    renterId: 'renter-1',
    classId: 'class-1',
    requestedVehicleId: vehicleId,
    assignedVehicleId: vehicleId,
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: new Date('2026-04-10T09:00:00Z'),
    endAt,
    effectiveEndAt: endAt,
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: nextBookingCode(),
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    ...overrides,
  }
}

/**
 * Build a COMPLETE persisted `Booking` (#900): `bookingInput` plus the
 * server-stamped persistence fields (`id`, `createdAt`, `updatedAt`) and the
 * server-derived `cancellationFeeSettlement` default. Use this anywhere a test
 * needs a full booking row rather than a create input; callers override only the
 * fields their assertion cares about.
 *
 * This is the single typechecked fixture chokepoint. `tests/helpers/**` is in the
 * api typecheck project (tsconfig.json), so the `: Booking` return type means a
 * NEW required field on `Booking` fails `tsc` HERE — instead of silently leaving
 * an untypechecked test-body fixture incomplete, which is the drift #900 closes.
 */
export function makeBooking(overrides: Partial<Booking> = {}): Booking {
  const stampedAt = new Date('2026-04-09T00:00:00Z')
  return {
    ...bookingInput(overrides),
    id: crypto.randomUUID(),
    createdAt: stampedAt,
    updatedAt: stampedAt,
    cancellationFeeSettlement: 'ADVISORY',
    ...overrides,
  }
}
