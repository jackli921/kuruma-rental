import { z } from 'zod'
import { LUGGAGE_SIZES } from '../lib/luggage'

const MIN_VEHICLE_YEAR = 1900
const MAX_VEHICLE_YEAR = 2100

// JPY rates are whole-yen integers. Zero is a valid value (free promo),
// but at least one of daily or hourly must be set on a vehicle — a car
// with no price is not rentable. Mirrored in the `vehicles_pricing_at_
// least_one` CHECK constraint on the vehicles table (see schema.ts and
// issue #48).
const jpyRate = z.number().int('Rate must be a whole yen amount').min(0, 'Rate cannot be negative')

// photos carries a .default() only on create. Kept off the base because Zod
// .partial() does NOT strip .default(), so a partial PATCH would re-inject
// { photos: [] } and wipe that column on write (issue #432, same root cause
// as #430).
const photosSchema = z.array(z.string().url())

// Raw object schema, no cross-field refinements. Kept separate so
// `updateVehicleSchema` can still be `.partial()` — `superRefine` wraps the
// result in ZodEffects which doesn't support `.partial()` directly.
const vehicleObjectSchema = z.object({
  classId: z.string().uuid('Class ID must be a valid UUID').nullish(),
  // Storefront placement (#435): the operator's pickup/return location for this
  // car. Nullish so a PATCH can clear it (explicit null) or omit it; tenant
  // ownership + existence are sealed by the composite FK (23503 -> 422), not
  // here. locations.id is a uuid, like classId.
  pickupLocationId: z.string().uuid('Pickup location ID must be a valid UUID').nullish(),
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional(),
  photos: photosSchema.optional(),
  seats: z.number().int().min(1, 'Must have at least 1 seat').max(50),
  // Per-vehicle luggage override (#457). Both nullish: omit to inherit the
  // class default, or submit explicit `null` to clear an override back to the
  // class default (same react-hook-form rationale as the rental rules above).
  // No `.default()` here — the class is the fallback, resolved at read time.
  luggageCapacity: z.number().int().min(0, 'Luggage capacity cannot be negative').nullish(),
  luggageSize: z.enum(LUGGAGE_SIZES).nullish(),
  transmission: z.enum(['AUTO', 'MANUAL']),
  fuelType: z.string().optional(),
  licensePlate: z.string().trim().max(20).nullish(),
  // Issue #50: rental rules. All three are nullish so the form can submit
  // `null` when a field is blank (same pattern as pricing #48). `.optional()`
  // alone would reject explicit null which react-hook-form emits when a
  // numeric input is cleared.
  minRentalHours: z.number().int().min(1, 'Minimum rental must be at least 1 hour').nullish(),
  maxRentalHours: z.number().int().min(1, 'Maximum rental must be at least 1 hour').nullish(),
  advanceBookingHours: z.number().int().min(0, 'Advance booking cannot be negative').nullish(),
  dailyRateJpy: jpyRate.nullish(),
  hourlyRateJpy: jpyRate.nullish(),
  shakenExpiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid calendar date')
    .nullish(),
  insuranceExpiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid calendar date')
    .nullish(),
  // Issue #228: vehicle detail fields for filtering. Nullish so the form
  // can submit `null` when a field is blank (same pattern as pricing #48).
  make: z.string().trim().nullish(),
  model: z.string().trim().nullish(),
  year: z.number().int().min(MIN_VEHICLE_YEAR).max(MAX_VEHICLE_YEAR).nullish(),
  color: z.string().trim().nullish(),
})

export const createVehicleSchema = vehicleObjectSchema
  .extend({
    // Defaults belong on create only — see photosSchema note (#432).
    photos: photosSchema.default([]),
    // #401: a non-operator (platform/legacy admin) caller may name the target
    // operator. OPERATOR_* callers' tenant comes from their token and this is
    // ignored for them. Optional — omit when exactly one operator exists.
    // `operators.id` is text (e.g. the seeded `op_best_car_rental`), not a UUID;
    // existence is enforced by the DB FK (23503 -> 422), not here.
    operatorId: z.string().min(1, 'Operator ID must not be empty').optional(),
  })
  .superRefine((data, ctx) => {
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

export const updateVehicleSchema = vehicleObjectSchema.partial().superRefine((data, ctx) => {
  // Only check when both rate keys are present in the patch — a patch with
  // just { name: "..." } shouldn't trigger the pricing rule.
  if ('dailyRateJpy' in data && 'hourlyRateJpy' in data) {
    if (data.dailyRateJpy == null && data.hourlyRateJpy == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dailyRateJpy'],
        message: 'At least one rate (daily or hourly) is required',
      })
    }
  }

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

// Issue #51: inline status toggle. Kept as its own tiny schema so the
// fleet list can bind a one-field mutation without sending the full
// update payload. Mirrors the `vehicle_status` pgEnum in schema.ts.
export const vehicleStatusEnum = z.enum(['AVAILABLE', 'MAINTENANCE', 'RETIRED'])
export const updateVehicleStatusSchema = z.object({
  status: vehicleStatusEnum,
})

// Issue #224: bulk status toggle for fleet list multi-select. RETIRED is
// intentionally excluded — bulk retire is a destructive action that requires
// individual confirmation per the issue spec.
export const MAX_BULK_VEHICLES = 50
export const bulkVehicleStatusEnum = z.enum(['AVAILABLE', 'MAINTENANCE'])
export type BulkVehicleStatus = z.infer<typeof bulkVehicleStatusEnum>

export const bulkUpdateVehicleStatusSchema = z.object({
  vehicleIds: z
    .array(z.string().uuid())
    .min(1, 'At least one vehicle ID is required')
    .max(MAX_BULK_VEHICLES, `Maximum ${MAX_BULK_VEHICLES} vehicles per request`)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate vehicle IDs are not allowed'),
  status: bulkVehicleStatusEnum,
})

export type BulkUpdateVehicleStatusInput = z.infer<typeof bulkUpdateVehicleStatusSchema>

// Issue #225: extended status toggle that accepts a reason when
// transitioning to MAINTENANCE. Reason is required for MAINTENANCE,
// ignored for other statuses.
export const updateVehicleStatusWithReasonSchema = z
  .object({
    status: vehicleStatusEnum,
    reason: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'MAINTENANCE' && !data.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Reason is required when setting status to MAINTENANCE',
      })
    }
  })

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>
export type CreateVehicleFormInput = z.input<typeof createVehicleSchema>
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>
export type UpdateVehicleStatusInput = z.infer<typeof updateVehicleStatusSchema>
export type UpdateVehicleStatusWithReasonInput = z.infer<typeof updateVehicleStatusWithReasonSchema>
export type VehicleStatus = z.infer<typeof vehicleStatusEnum>
