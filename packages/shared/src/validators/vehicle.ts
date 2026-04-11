import { z } from 'zod'

// JPY rates are whole-yen integers. Zero is a valid value (free promo),
// but at least one of daily or hourly must be set on a vehicle — a car
// with no price is not rentable. Mirrored in the `vehicles_pricing_at_
// least_one` CHECK constraint on the vehicles table (see schema.ts and
// issue #48).
const jpyRate = z.number().int('Rate must be a whole yen amount').min(0, 'Rate cannot be negative')

// Raw object schema, no cross-field refinements. Kept separate so
// `updateVehicleSchema` can still be `.partial()` — `superRefine` wraps the
// result in ZodEffects which doesn't support `.partial()` directly.
const vehicleObjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional(),
  photos: z.array(z.string().url()).default([]),
  seats: z.number().int().min(1, 'Must have at least 1 seat').max(50),
  transmission: z.enum(['AUTO', 'MANUAL']),
  fuelType: z.string().optional(),
  bufferMinutes: z.number().int().min(0).default(60),
  minRentalHours: z.number().int().min(1).optional(),
  maxRentalHours: z.number().int().min(1).optional(),
  advanceBookingHours: z.number().int().min(0).optional(),
  dailyRateJpy: jpyRate.nullish(),
  hourlyRateJpy: jpyRate.nullish(),
})

export const createVehicleSchema = vehicleObjectSchema.superRefine((data, ctx) => {
  if (data.dailyRateJpy == null && data.hourlyRateJpy == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dailyRateJpy'],
      message: 'At least one rate (daily or hourly) is required',
    })
  }
})

export const updateVehicleSchema = vehicleObjectSchema.partial()

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>
export type CreateVehicleFormInput = z.input<typeof createVehicleSchema>
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>
