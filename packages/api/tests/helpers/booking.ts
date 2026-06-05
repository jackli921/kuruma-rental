import type { Booking } from '../../src/stores'

type NewBooking = Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>

let codeSeq = 0
/**
 * Unique reservation code per call. `bookings.bookingCode` is NOT NULL UNIQUE
 * (#392), so fixtures that don't care about the code itself must still avoid
 * collisions on the in-memory unique mirror. Base36 keeps it short + readable.
 */
export function nextBookingCode(): string {
  codeSeq += 1
  return `T${codeSeq.toString(36).toUpperCase().padStart(7, '0')}`
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
    bookingCode: nextBookingCode(),
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    ...overrides,
  }
}
