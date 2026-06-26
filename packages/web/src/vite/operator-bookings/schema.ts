import {
  type BookingDto,
  addOnSnapshotSchema,
  bookingDtoSchema,
  feeSnapshotItemSchema,
  insuranceSnapshotSchema,
} from '@/vite/bookings/api'
import type { BookingEventPayload, BookingEventType } from '@kuruma/shared/db/schema'
import {
  BOOKING_EVENT_TYPES,
  BOOKING_FULFILLMENT_MODES,
  BOOKING_STATUSES,
  CANCELLATION_REASON_CODES,
} from '@kuruma/shared/enums'
import { z } from 'zod'

// #711 (3b): Zod schemas for the operator-bookings *response* bodies, extracted to
// a sibling schema.ts so `api.ts` can thread `unwrap(res, schema)` and stay z-free
// (the #785 convention — large-DTO clients keep their response schemas here). The
// schema is the single source: each owned DTO type is inferred from it, and the
// DTOs that mirror a shared contract are pinned with `satisfies z.ZodType<T>` so
// they cannot drift from that contract without a compile error.
//
// Wire shape: the API JSON-serializes its `Date` columns, so every date field
// arrives as an ISO string — these schemas mirror the API projections with
// `Date` -> `z.string()`. Enum members come from `@kuruma/shared/enums` (the
// SSoT) so a renamed status fails to compile here, not silently at runtime.

// The two expansion blocks the operator reads share one shape across the list
// (calendar) and the single (detail) reads, so they are declared once.
const vehicleBlockSchema = z.object({ name: z.string(), photos: z.array(z.string()) })
const renterBlockSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  language: z.string(),
})

/**
 * One `GET /bookings?expand=renter` item the calendar reads. `effectiveEndAt` and
 * `assignedVehicleId` are always sent by the API but kept optional here (the
 * mapper falls back), so this schema stays looser than the producer — never
 * stricter, which would reject valid data.
 */
export const rawOperatorBookingSchema = z.object({
  id: z.string(),
  bookingCode: z.string(),
  status: z.enum(BOOKING_STATUSES),
  startAt: z.string(),
  endAt: z.string(),
  effectiveEndAt: z.string().optional(),
  assignedVehicleId: z.string().nullable().optional(),
  totalPrice: z.number().nullable(),
  vehicle: vehicleBlockSchema.optional(),
  renter: renterBlockSchema.optional(),
})
export type RawOperatorBooking = z.infer<typeof rawOperatorBookingSchema>

/**
 * A calendar day-view column / sidebar-filter row. The API's `GET /vehicles`
 * returns full vehicle rows; this projects to `{id, name}` (Zod objects are
 * non-strict, so the rest is stripped at the seam).
 */
export const calendarVehicleRowSchema = z.object({ id: z.string(), name: z.string() })

/**
 * `GET /bookings/:id?expand=vehicle,renter` — a superset of the renter BookingDto
 * carrying the assigned car + renter on top of the operator block. Composed from
 * the shared `bookingDtoSchema` so the base contract stays single-sourced.
 */
export interface OperatorBookingDetailDto extends BookingDto {
  vehicle?: { name: string; photos: string[] } | undefined
  renter?: { id: string; name: string | null; email: string | null; language: string } | undefined
}
export const operatorBookingDetailSchema = bookingDtoSchema.extend({
  vehicle: vehicleBlockSchema.optional(),
  renter: renterBlockSchema.optional(),
}) satisfies z.ZodType<OperatorBookingDetailDto>

// One AVAILABLE same-store, same-ACRISS replacement candidate. The API returns a
// full vehicle row; this projects to the three fields the picker label needs.
export const substitutionCandidateRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  licensePlate: z.string().nullable().optional(),
})

/**
 * One `GET /customers/search` row the manual-booking picker (#589 1d slice 3)
 * reads. The API returns a full User; this pins only the four fields the picker
 * shows — Zod strips the rest at the seam. name/email/phone are nullable (a
 * phone-only walk-in has no email; a quick-created row may have no name).
 */
export const customerSearchResultSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
})
export type CustomerSearchResult = z.infer<typeof customerSearchResultSchema>

// --- Lifecycle events (#716 discriminated payload) ---------------------------
// `payload` is the shared `BookingEventPayload`, a union keyed on `type` (the
// storage-side discriminant the read mapper backfills). Each variant is pinned to
// its shared member via the union's `satisfies z.ZodType<BookingEventPayload>`, so
// a shape change in the shared union fails to compile here. The BOOKING_CREATED
// variant embeds the same snapshots as a booking, so it reuses their schemas.
const bookingCreatedPayloadSchema = z.object({
  type: z.literal('BOOKING_CREATED'),
  // #464: null on CLASS_COMBO floats — operator assigns a concrete car later.
  requestedVehicleId: z.string().nullable(),
  assignedVehicleId: z.string().nullable(),
  classId: z.string(),
  fulfillmentMode: z.enum(BOOKING_FULFILLMENT_MODES),
  startAt: z.string(),
  endAt: z.string(),
  totalPrice: z.number(),
  insuranceSnapshot: insuranceSnapshotSchema.nullable(),
  feeSnapshot: z.array(feeSnapshotItemSchema),
  addOnSnapshot: z.array(addOnSnapshotSchema),
})
const vehicleSubstitutedPayloadSchema = z.object({
  type: z.literal('VEHICLE_SUBSTITUTED'),
  // #464: null when a CLASS_COMBO float is assigned its first car (null -> car).
  fromVehicleId: z.string().nullable(),
  toVehicleId: z.string(),
  reason: z.string().nullable(),
})
const vehicleAssignedPayloadSchema = z.object({
  type: z.literal('VEHICLE_ASSIGNED'),
  // #464: null on initial assignment (CLASS_COMBO float gets its first car).
  fromVehicleId: z.string().nullable(),
  toVehicleId: z.string(),
  reason: z.string().nullable(),
})
const bookingCancelledPayloadSchema = z.object({
  type: z.literal('BOOKING_CANCELLED'),
  cancellationFee: z.number().nullable(),
  cancelledAt: z.string(),
  // #868 3b: the optional renter reason. `.default(null)` is load-bearing —
  // BOOKING_CANCELLED events stored before this slice have no such key, so the
  // operator timeline must read them as "no reason" rather than fail to parse.
  cancellationReason: z
    .object({ code: z.enum(CANCELLATION_REASON_CODES), note: z.string().nullable() })
    .nullable()
    .default(null),
})
const statusChangedPayloadSchema = z.object({
  type: z.literal('STATUS_CHANGED'),
  from: z.enum(BOOKING_STATUSES),
  to: z.enum(BOOKING_STATUSES),
})
const bookingEventPayloadSchema = z.discriminatedUnion('type', [
  bookingCreatedPayloadSchema,
  vehicleSubstitutedPayloadSchema,
  vehicleAssignedPayloadSchema,
  bookingCancelledPayloadSchema,
  statusChangedPayloadSchema,
]) satisfies z.ZodType<BookingEventPayload>

/** One lifecycle event the operator timeline reads (dates are ISO JSON). */
export interface BookingEventDto {
  id: string
  type: BookingEventType
  payload: BookingEventPayload
  actorId: string | null
  createdAt: string
}
export const bookingEventSchema = z.object({
  id: z.string(),
  type: z.enum(BOOKING_EVENT_TYPES),
  payload: bookingEventPayloadSchema,
  actorId: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<BookingEventDto>
