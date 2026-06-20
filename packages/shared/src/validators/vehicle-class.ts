import { z } from 'zod'
import { ACRISS_PATTERN } from '../acriss'
import { TRANSMISSIONS } from '../enums'
import { LUGGAGE_SIZES } from '../lib/luggage'
import { HTTP_URL_MESSAGE, isHttpUrl } from './url'

// photos/sortOrder carry .default()s only on create. Kept off the base because
// Zod .partial() does NOT strip .default(), so a partial PATCH would re-inject
// { photos: [], sortOrder: 0 } and wipe those columns on write (issue #430).
// Entries are http(s) URLs (#967, see validators/url.ts) — the refine rides
// after .max(2048) since .max() is a ZodString method, gone once refined.
const photosSchema = z
  .array(z.string().url().max(2048).refine(isHttpUrl, { message: HTTP_URL_MESSAGE }))
  .max(20)
const sortOrderSchema = z.number().int().min(0)

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const vehicleClassObjectSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .max(100)
    .regex(SLUG_PATTERN, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().trim().max(2000).optional(),
  photos: photosSchema.optional(),
  seats: z.number().int().min(1, 'Must have at least 1 seat').max(50),
  luggageCapacity: z.number().int().min(0, 'Luggage capacity cannot be negative'),
  // Class-level default luggage size (#457) — the fallback when a vehicle leaves
  // its size blank. Optional on the base (no default) so a partial PATCH never
  // re-injects it; the create .extend() supplies the default (#430 pattern).
  luggageSize: z.enum(LUGGAGE_SIZES).optional(),
  transmission: z.enum(TRANSMISSIONS),
  fuelType: z.string().trim().max(50).optional(),
  // ACRISS taxonomy code (#388). Format-only validation against the single
  // ACRISS_PATTERN source — the value is normalised to upper-case so 'ccar'
  // and 'CCAR' are the same code. Nullish: existing/operator-created classes
  // without a mapped code still validate (the friendly label is the renter
  // surface). Lives on the base object so it flows to both create and update;
  // operatorId stays on the create .extend() only (non-patchable).
  acrissCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(ACRISS_PATTERN, 'Invalid ACRISS code')
    .nullish(),
  sortOrder: sortOrderSchema.optional(),
})

export const createVehicleClassSchema = vehicleClassObjectSchema.extend({
  // Defaults belong on create only — see photosSchema/sortOrderSchema note (#430).
  photos: photosSchema.default([]),
  sortOrder: sortOrderSchema.default(0),
  // Default belongs on create only — see #430 note above.
  luggageSize: z.enum(LUGGAGE_SIZES).default('MEDIUM'),
  // #401: a non-operator (platform/legacy admin) caller may name the target
  // operator. OPERATOR_* callers' tenant comes from their token and this is
  // ignored for them. Optional — omit when exactly one operator exists.
  // `operators.id` is text (e.g. the seeded `op_best_car_rental`), not a UUID;
  // existence is enforced by the DB FK (23503 -> 422), not here.
  operatorId: z.string().min(1, 'Operator ID must not be empty').optional(),
})

// #406: classes no longer carry pricing — rates live on the vehicle. No
// "at least one rate" refinement here anymore.
export const updateVehicleClassSchema = vehicleClassObjectSchema.partial()

export type CreateVehicleClassInput = z.infer<typeof createVehicleClassSchema>
export type CreateVehicleClassFormInput = z.input<typeof createVehicleClassSchema>
export type UpdateVehicleClassInput = z.infer<typeof updateVehicleClassSchema>
