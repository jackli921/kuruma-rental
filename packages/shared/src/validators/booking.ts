import { z } from 'zod'

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
    // Staff-override path only: book on behalf of a renter (#314). Non-staff
    // routes ignore this and use the authenticated user.
    renterId: z.string().uuid('Renter ID must be a valid UUID').optional(),
    startAt: z.string().datetime({ message: 'Must be ISO datetime' }),
    endAt: z.string().datetime({ message: 'Must be ISO datetime' }),
    notes: z.string().optional(),
    source: z.enum(['DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER']).default('DIRECT'),
    externalId: z.string().optional(),
    idempotencyKey: z.string().uuid('Must be a valid UUID').optional(),
  })
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: 'End time must be after start time',
    path: ['endAt'],
  })

export const updateBookingStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'], {
    message: 'Status must be CONFIRMED, ACTIVE, COMPLETED, or CANCELLED',
  }),
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>
export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>
