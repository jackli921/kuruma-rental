import { z } from 'zod'

// Issue #74: totalPrice is NOT accepted from clients. It is computed
// server-side by `calculateBookingPrice` using the vehicle's dailyRateJpy
// and hourlyRateJpy. Any client that sends `totalPrice` has it silently
// dropped by Zod, and the server writes its own computed value.
export const createBookingSchema = z
  .object({
    vehicleId: z.string().min(1, 'Vehicle ID is required'),
    startAt: z.string().datetime({ message: 'Must be ISO datetime' }),
    endAt: z.string().datetime({ message: 'Must be ISO datetime' }),
    notes: z.string().optional(),
    source: z.enum(['DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER']).default('DIRECT'),
    externalId: z.string().optional(),
  })
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: 'End time must be after start time',
    path: ['endAt'],
  })

export const cancelBookingSchema = z.object({
  reason: z.string().optional(),
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>
