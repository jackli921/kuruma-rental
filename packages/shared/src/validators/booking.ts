import { z } from 'zod'
import { BOOKING_SOURCES, BOOKING_STATUSES } from '../enums'

// Slice 6 (#392): the renter books a CONCRETE vehicle chosen in the storefront
// (slice 5) — `requestedVehicleId`. The server derives operatorId, classId,
// assignedVehicleId (= requested at submit) and totalPrice from that vehicle;
// none of those are client fields (proposal §6.2, §4.1). Zod strips unknown
// keys by default, so a client that injects assignedVehicleId / totalPrice /
// bookingCode / operatorId / snapshot fields has them silently dropped, and the
// server writes its own values (#74 for price).
export const createBookingSchema = z
  .object({
    requestedVehicleId: z.string().uuid('Requested vehicle ID must be a valid UUID'),
    pickupLocationId: z.string().uuid('Pickup location ID must be a valid UUID'),
    dropoffLocationId: z.string().uuid('Dropoff location ID must be a valid UUID'),
    // Renter's selected insurance option (this operator's active options).
    // Null/absent = declines coverage or operator has none.
    insuranceOptionId: z.string().uuid('Insurance option ID must be a valid UUID').optional(),
    // Selected paid add-ons (#460): 0+ of the operator's ACTIVE add-ons. The
    // server validates each belongs to the booking's operator + snapshots them
    // onto the booking (flat priceJpy each, added to totalPrice).
    addOnIds: z.string().uuid('Add-on ID must be a valid UUID').array().default([]),
    // Staff-override path only: book on behalf of a renter (#314). Non-staff
    // routes ignore this and use the authenticated user.
    renterId: z.string().uuid('Renter ID must be a valid UUID').optional(),
    startAt: z.string().datetime({ message: 'Must be ISO datetime' }),
    endAt: z.string().datetime({ message: 'Must be ISO datetime' }),
    notes: z.string().optional(),
    source: z.enum(BOOKING_SOURCES).default('DIRECT'),
    externalId: z.string().optional(),
    idempotencyKey: z.string().uuid('Must be a valid UUID').optional(),
    // #613: renter liability-disclaimer (免责声明) consent. The renter ticks the
    // checkbox at checkout; the server stamps acknowledgedAt + the terms version.
    // Optional here because the route forces source=DIRECT for renters and exempts
    // staff/manual bookings — the service requires it by caller role, not source.
    disclaimerAccepted: z.boolean().optional(),
  })
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: 'End time must be after start time',
    path: ['endAt'],
  })

export const updateBookingStatusSchema = z.object({
  status: z.enum(BOOKING_STATUSES, {
    message: 'Status must be CONFIRMED, ACTIVE, COMPLETED, or CANCELLED',
  }),
})

// Slice 6 (#392 §5.5): operator-only vehicle substitution. The new vehicle must
// be the same operator + pickup location + ACRISS class as the booking (the
// service enforces those; the schema only shapes the request body).
export const substituteVehicleSchema = z.object({
  newVehicleId: z.string().uuid('New vehicle ID must be a valid UUID'),
  reason: z.string().optional(),
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>
export type SubstituteVehicleInput = z.infer<typeof substituteVehicleSchema>
