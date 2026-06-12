import { z } from 'zod'
import type { LocationOperatingHours } from '../types/location'

export type { LocationOperatingHours }

/** "HH:mm" 24-hour clock. Locked MVP operating-hours format (issue #387 #5). */
const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Validate an IANA timezone by asking the platform's Intl database directly,
 * rather than maintaining our own list. Bun/Node ship full ICU, so unknown
 * zones throw a RangeError. `Asia/Tokyo` is the MVP default.
 */
function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const operatingHoursSchema = z
  .object({
    openTime: z.string().regex(HH_MM_PATTERN, 'openTime must be HH:mm (24-hour)'),
    closeTime: z.string().regex(HH_MM_PATTERN, 'closeTime must be HH:mm (24-hour)'),
  })
  .strict()
  .nullable()
  // MVP shape is a single same-day pair; overnight/wrap-around is not modeled
  // yet (issue #387 #5), so an inverted or empty range is a typo, not a
  // midnight-spanning window. Zero-padded HH:mm compares correctly as strings.
  // Attach to closeTime (not the object root) so the form renders the message
  // under the closeTime field it already shows, instead of failing silently.
  .refine((hours) => hours === null || hours.openTime < hours.closeTime, {
    message: 'closeTime must be after openTime',
    path: ['closeTime'],
  })

// Field schemas WITHOUT defaults, so the update (partial) variant can reuse them
// without injecting defaults on an empty PATCH. zod v4 `.partial()` keeps a
// field's `.default()`, so defaults are applied per-schema only where wanted
// (create), never on update — a partial PATCH must not silently reset fields.
const nameSchema = z.string().trim().min(1, 'Name is required').max(200)
const addressSchema = z.string().trim().min(1, 'Address is required').max(500)
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Must be a valid IANA timezone')
// §9 item 20: 48h default cooldown before the same vehicle is bookable again.
// 60-min floor (#551): guarantees a real servicing gap between rentals. This is
// a service-quality minimum, not overlap-safety — overlap is already impossible
// at any turnaround via the bookings_no_overlap exclusion constraint.
/**
 * Minimum servicing gap between rentals, in minutes (#551). Single app-layer
 * source for the floor — shared by this Zod schema and the LocationForm input.
 * The DB CHECK `locations_turnaround_min_60` (schema.ts + the 0050 migration SQL)
 * stays a literal `60` on purpose: regenerating it to interpolate the constant
 * would churn the migration snapshot for no behavioural change.
 */
export const MIN_TURNAROUND_MINUTES = 60
const turnaroundSchema = z
  .number()
  .int('Turnaround must be a whole number of minutes')
  .min(MIN_TURNAROUND_MINUTES, `Turnaround must be at least ${MIN_TURNAROUND_MINUTES} minutes`)

// WGS84 decimal degrees (#531). Bounds reject NaN/±Infinity on their own (the
// comparison is false for non-finite values), but the explicit finiteness
// refine documents the invariant and survives any loosening of the bounds.
const latitudeSchema = z
  .number()
  .refine(Number.isFinite, 'latitude must be a finite number')
  .refine((n) => n >= -90 && n <= 90, 'latitude must be between -90 and 90')
const longitudeSchema = z
  .number()
  .refine(Number.isFinite, 'longitude must be a finite number')
  .refine((n) => n >= -180 && n <= 180, 'longitude must be between -180 and 180')

// lat/lng are captured as a pair: both numbers, both null (clear), or both
// absent. Exactly one is a malformed request — a half-pin can't be geocoded or
// plotted. `coordinateSource` is server-derived per the #531 matrix and is
// deliberately absent from every schema below (a client value is stripped).
const coordPairIsComplete = (d: {
  latitude?: number | null | undefined
  longitude?: number | null | undefined
}): boolean => {
  const hasLat = d.latitude !== undefined && d.latitude !== null
  const hasLng = d.longitude !== undefined && d.longitude !== null
  return hasLat === hasLng
}
const COORD_PAIR_REFINEMENT = {
  message: 'latitude and longitude must be provided together',
  path: ['latitude'],
}

// Shared base so create + platform-admin + update derive the same field set
// (the .refine() below would turn this into a ZodEffects that can't be
// .extend()ed, so the operatorId variant spreads the raw fields instead).
const createLocationFields = {
  name: nameSchema,
  address: addressSchema,
  // Omitted -> null so the repo always writes a concrete value.
  operatingHours: operatingHoursSchema.default(null),
  timezone: timezoneSchema.default('Asia/Tokyo'),
  defaultTurnaroundMinutes: turnaroundSchema.default(2880),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
}

export const createLocationSchema = z
  .object(createLocationFields)
  .refine(coordPairIsComplete, COORD_PAIR_REFINEMENT)

// Platform-admin writes are cross-tenant, so they MUST name the target operator
// explicitly (issue #387 amendment item 2). Operator callers never send this —
// the route stamps ctx.operatorId.
export const platformAdminCreateLocationSchema = z
  .object({
    ...createLocationFields,
    operatorId: z.string().trim().min(1, 'operatorId is required'),
  })
  .refine(coordPairIsComplete, COORD_PAIR_REFINEMENT)

export const updateLocationSchema = z
  .object({
    name: nameSchema,
    address: addressSchema,
    operatingHours: operatingHoursSchema,
    timezone: timezoneSchema,
    defaultTurnaroundMinutes: turnaroundSchema,
    latitude: latitudeSchema.nullable(),
    longitude: longitudeSchema.nullable(),
    // Force a re-geocode of the current address even when it didn't change.
    regeocode: z.boolean(),
  })
  .partial()
  .refine(coordPairIsComplete, COORD_PAIR_REFINEMENT)

export type CreateLocationInput = z.infer<typeof createLocationSchema>
export type CreateLocationFormInput = z.input<typeof createLocationSchema>
export type PlatformAdminCreateLocationInput = z.infer<typeof platformAdminCreateLocationSchema>
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>
