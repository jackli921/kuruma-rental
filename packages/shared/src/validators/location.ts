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
const turnaroundSchema = z
  .number()
  .int('Turnaround must be a whole number of minutes')
  .min(60, 'Turnaround must be at least 60 minutes')

export const createLocationSchema = z.object({
  name: nameSchema,
  address: addressSchema,
  // Omitted -> null so the repo always writes a concrete value.
  operatingHours: operatingHoursSchema.default(null),
  timezone: timezoneSchema.default('Asia/Tokyo'),
  defaultTurnaroundMinutes: turnaroundSchema.default(2880),
})

// Platform-admin writes are cross-tenant, so they MUST name the target operator
// explicitly (issue #387 amendment item 2). Operator callers never send this —
// the route stamps ctx.operatorId.
export const platformAdminCreateLocationSchema = createLocationSchema.extend({
  operatorId: z.string().trim().min(1, 'operatorId is required'),
})

export const updateLocationSchema = z
  .object({
    name: nameSchema,
    address: addressSchema,
    operatingHours: operatingHoursSchema,
    timezone: timezoneSchema,
    defaultTurnaroundMinutes: turnaroundSchema,
  })
  .partial()

export type CreateLocationInput = z.infer<typeof createLocationSchema>
export type CreateLocationFormInput = z.input<typeof createLocationSchema>
export type PlatformAdminCreateLocationInput = z.infer<typeof platformAdminCreateLocationSchema>
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>
