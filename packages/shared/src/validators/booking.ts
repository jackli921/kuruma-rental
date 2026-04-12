import { z } from 'zod'

// Issue #74: totalPrice is NOT accepted from clients. It is computed
// server-side by `calculateBookingPrice` using the vehicle's dailyRateJpy
// and hourlyRateJpy. Any client that sends `totalPrice` has it silently
// dropped by Zod, and the server writes its own computed value.
export const createBookingSchema = z
  .object({
    vehicleId: z.string().uuid('Vehicle ID must be a valid UUID'),
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
