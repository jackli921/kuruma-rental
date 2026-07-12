import { z } from 'zod'
import { BOOKING_SOURCES, BOOKING_STATUSES, CANCELLATION_REASON_CODES } from '../enums'

// Fields common to every booking regardless of fulfillment mode (#464) — spread
// into each discriminated-union member below so the two modes share one
// definition. Zod strips unknown keys by default, so a client that injects
// assignedVehicleId / totalPrice / bookingCode / operatorId / snapshot fields has
// them silently dropped, and the server writes its own values (#74 for price).
const bookingCommonFields = {
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
  // #589 1c: operator walk-in path — book for a brand-new customer inline by
  // name + phone. NO email field by design: email is globally unique, so a
  // create-by-email would leak whether an address already exists (#396/#475);
  // phone → synthetic placeholder email avoids the oracle. Used in place of
  // renterId (mutually exclusive — see refine below); the service creates a
  // fresh renter, then books (pre-tx ordering / orphan tradeoff: #875).
  walkInCustomer: z
    .object({
      name: z.string().trim().min(1, 'Name is required'),
      phone: z.string().trim().min(1, 'Phone is required'),
    })
    .optional(),
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
  // #877 Slice B: the renter accepted the operator's published OPERATOR_RENTAL_TERMS
  // at checkout, pinning the EXACT version + displayed locale they rendered. Optional
  // at the type level; the service requires them only for a self-serve RENTER when the
  // operator has a published+effective doc and the server flag is on (else 422). The
  // version is a `v1`-style string compared EXACTLY (a stale pin → 422 CHANGED), never
  // "resolve latest" — that would sign text the renter never saw (consent TOCTOU, C1).
  operatorRentalTermsAccepted: z.boolean().optional(),
  operatorRentalTermsAcceptedVersion: z.string().optional(),
  locale: z.enum(['en', 'ja', 'zh']).optional(),
} as const

// #464 SPECIFIC = the renter books a CONCRETE vehicle (requestedVehicleId) — the
// only mode pre-#464. The server derives operatorId/classId/assignedVehicleId/
// totalPrice from that vehicle; none are client fields (proposal §6.2, §4.1).
const specificBookingSchema = z.object({
  fulfillmentMode: z.literal('SPECIFIC'),
  requestedVehicleId: z.string().uuid('Requested vehicle ID must be a valid UUID'),
  ...bookingCommonFields,
})

// #464 CLASS_COMBO = the renter books a vehicle CLASS at a pickup location; no
// car is chosen at book time (the booking "floats"). The operator assigns a
// concrete car on/before pickup. Priced off the class rate plan (slice 2).
const classComboBookingSchema = z.object({
  fulfillmentMode: z.literal('CLASS_COMBO'),
  classId: z.string().uuid('Class ID must be a valid UUID'),
  ...bookingCommonFields,
})

export const createBookingSchema = z
  .preprocess(
    // Back-compat: a body without fulfillmentMode is a pre-#464 SPECIFIC booking.
    (value) =>
      value && typeof value === 'object' && !('fulfillmentMode' in value)
        ? { ...value, fulfillmentMode: 'SPECIFIC' }
        : value,
    z.discriminatedUnion('fulfillmentMode', [specificBookingSchema, classComboBookingSchema]),
  )
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: 'End time must be after start time',
    path: ['endAt'],
  })
  // #589 1c: renterId (book for an existing customer) and walkInCustomer (create
  // a brand-new one inline) are two mutually exclusive customer sources — never
  // both on one request.
  .refine((data) => !(data.renterId && data.walkInCustomer), {
    message: 'Provide either renterId or walkInCustomer, not both',
    path: ['walkInCustomer'],
  })
  // #1430: a CLASS_COMBO must be returned to its pickup location. The renter
  // books off an availability card that can only size the occupancy window by
  // the PICKUP turnaround (no dropoff is chosen at browse time), while booking
  // creation sizes it by the DROPOFF turnaround (booking-creation.ts
  // resolveDropoffEffectiveEnd). Allowing a one-way combo lets the card and the
  // write-side disagree ("advertised but sold out at checkout"). One-way combos
  // are unsupported product-wide, so the contract forbids them here. SPECIFIC
  // bookings are unaffected (they carry a concrete vehicle, not a class float).
  .refine(
    (data) =>
      data.fulfillmentMode !== 'CLASS_COMBO' || data.dropoffLocationId === data.pickupLocationId,
    {
      message: 'Class-combo bookings must be returned to the pickup location',
      path: ['dropoffLocationId'],
    },
  )

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

// #464: operator assigns a concrete car to a CLASS_COMBO float (no reprice).
// vehicleId is the concrete car to assign; reason is optional operator note.
export const assignVehicleSchema = z.object({
  vehicleId: z.string().uuid('Vehicle ID must be a valid UUID'),
  reason: z.string().optional(),
})

// #868 Slice 3b: optional renter cancellation reason on POST /bookings/:id/cancel.
// ALWAYS optional — the cancel succeeds with or without it (the body may even be
// absent: the operator cancel sends none). `note` is a short freeform elaboration,
// trimmed + capped. `nullish`, not `optional`: the web sends `note: null` (not an
// absent key) when the renter leaves it blank — matching CancellationReason.note's
// `string | null` — so the validator must accept null too. The validator trims, then
// the route collapses an empty/whitespace/null note to null (`note || null`) so no
// caller — web or Trip.com — can persist a meaningless "" note.
export const cancellationReasonSchema = z.object({
  code: z.enum(CANCELLATION_REASON_CODES),
  note: z.string().trim().max(500, 'Note must be 500 characters or fewer').nullish(),
})
export const cancelBookingSchema = z.object({
  reason: cancellationReasonSchema.optional(),
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>
export type SubstituteVehicleInput = z.infer<typeof substituteVehicleSchema>
export type AssignVehicleInput = z.infer<typeof assignVehicleSchema>
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>
