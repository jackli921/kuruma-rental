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
  // Issue #50: rental rules. All three are nullish so the form can submit
  // `null` when a field is blank (same pattern as pricing #48). `.optional()`
  // alone would reject explicit null which react-hook-form emits when a
  // numeric input is cleared.
  minRentalHours: z.number().int().min(1, 'Minimum rental must be at least 1 hour').nullish(),
  maxRentalHours: z.number().int().min(1, 'Maximum rental must be at least 1 hour').nullish(),
  advanceBookingHours: z.number().int().min(0, 'Advance booking cannot be negative').nullish(),
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

  // Issue #50: if both rental bounds are set, min must be <= max. Otherwise
  // the owner could create a vehicle nobody can book ("min 10h, max 5h").
  // Enforced here rather than on the column so each field can still be
  // optional independently.
  const min = data.minRentalHours
  const max = data.maxRentalHours
  if (min != null && max != null && min > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxRentalHours'],
      message: 'Maximum rental hours must be greater than or equal to minimum',
    })
  }
})

export const updateVehicleSchema = vehicleObjectSchema.partial()

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>
export type CreateVehicleFormInput = z.input<typeof createVehicleSchema>
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>
