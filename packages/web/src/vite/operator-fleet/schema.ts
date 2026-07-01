import {
  BOOKING_SOURCES,
  LOCATION_STATUSES,
  TRANSMISSIONS,
  VEHICLE_STATUSES,
} from '@kuruma/shared/enums'
import { LUGGAGE_SIZES } from '@kuruma/shared/lib/luggage'
import { z } from 'zod'

// #711/#785: Zod schemas for the operator-fleet *response* bodies, extracted to a
// sibling schema.ts so `api.ts` can thread `unwrap(res, schema)` without two
// ~30-field DTOs crowding the client (the #785 convention — large-DTO clients
// keep their response schemas here, small ones may stay inline). The schema is
// the single source: each DTO type is inferred from it.
//
// Wire shape: the API JSON-serializes the shared `Date` columns, so every date
// field arrives as an ISO string — these schemas mirror the shared
// `FleetVehicleOverview` / `VehicleDetail` contracts with `Date` -> `z.string()`.
// Enum members come from the `@kuruma/shared/enums` tuples (the SSoT) so a
// renamed status fails to compile here, not silently at runtime.

/**
 * The shared `VehicleBase` columns as they arrive over JSON (dates = ISO
 * strings). Spread into both fleet DTOs below, mirroring `extends VehicleBase`.
 */
const vehicleBaseShape = {
  id: z.string(),
  operatorId: z.string(),
  classId: z.string().nullable(),
  pickupLocationId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  photos: z.array(z.string()),
  seats: z.number(),
  luggageCapacity: z.number().nullable(),
  luggageSize: z.enum(LUGGAGE_SIZES).nullable(),
  transmission: z.enum(TRANSMISSIONS),
  fuelType: z.string().nullable(),
  licensePlate: z.string().nullable(),
  status: z.enum(VEHICLE_STATUSES),
  minRentalHours: z.number().nullable(),
  maxRentalHours: z.number().nullable(),
  advanceBookingHours: z.number().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().nullable(),
  color: z.string().nullable(),
  dailyRateJpy: z.number().nullable(),
  hourlyRateJpy: z.number().nullable(),
  shakenExpiryDate: z.string().nullable(),
  insuranceExpiryDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
} as const

/**
 * The bare vehicle row returned by every *write* endpoint (create / update /
 * status / bulk-status / retire): the shared `Vehicle` (= `VehicleBase`) over
 * JSON, with none of the fleet-overview enrichment. #817: the writes used to
 * pass through unvalidated because the enriched `operatorFleetVehicleSchema`
 * would reject a bare row — this is the schema that matches their wire body.
 */
export const vehicleRowSchema = z.object(vehicleBaseShape)
export type VehicleRow = z.infer<typeof vehicleRowSchema>
export const vehicleRowListSchema = z.array(vehicleRowSchema)

/** A booking touching a fleet vehicle (current/next), dates as ISO strings. */
export const fleetBookingSummarySchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  renterName: z.string().nullable(),
})
export type FleetBookingSummary = z.infer<typeof fleetBookingSummarySchema>

/** One row from `GET /vehicles/fleet-overview` (shared `FleetVehicleOverview`). */
export const operatorFleetVehicleSchema = z.object({
  ...vehicleBaseShape,
  utilization: z.number(),
  bookingCountLast30Days: z.number(),
  currentBooking: fleetBookingSummarySchema.nullable(),
  nextBooking: fleetBookingSummarySchema.nullable(),
  activeMaintenanceReason: z.string().nullable(),
})
export type OperatorFleetVehicle = z.infer<typeof operatorFleetVehicleSchema>

export const operatorFleetListSchema = z.array(operatorFleetVehicleSchema)

export const photoUploadResultSchema = z.object({
  uploaded: z.array(z.string()),
  total: z.number(),
})
export type PhotoUploadResult = z.infer<typeof photoUploadResultSchema>

export const photoDeleteResultSchema = z.object({
  deleted: z.string(),
  remaining: z.number(),
})
export type PhotoDeleteResult = z.infer<typeof photoDeleteResultSchema>

/** A maintenance log entry as JSON transport (dates = ISO strings). */
export const vehicleMaintenanceLogSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  reason: z.string(),
  notes: z.string().nullable(),
  costJpy: z.number().nullable(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type VehicleMaintenanceLogDto = z.infer<typeof vehicleMaintenanceLogSchema>

/** An upcoming booking on the detail page (dates = ISO strings). */
export const vehicleDetailBookingSchema = z.object({
  id: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  renterName: z.string().nullable(),
  source: z.enum(BOOKING_SOURCES),
  // The detail endpoint only surfaces live bookings — a deliberate subset of
  // BOOKING_STATUSES, so it is spelled out rather than drawn from the tuple.
  status: z.enum(['CONFIRMED', 'ACTIVE']),
})
export type VehicleDetailBookingDto = z.infer<typeof vehicleDetailBookingSchema>

/** One day's booked-hours bucket for the 30-day utilization strip. */
export const dailyUtilizationSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  bookedHours: z.number(),
})
export type DailyUtilizationDto = z.infer<typeof dailyUtilizationSchema>

/** `GET /vehicles/:id/detail` response (shared `VehicleDetail` over JSON). */
export const vehicleDetailResponseSchema = z.object({
  ...vehicleBaseShape,
  maintenanceLogs: z.array(vehicleMaintenanceLogSchema),
  upcomingBookings: z.array(vehicleDetailBookingSchema),
  revenueLast7d: z.number(),
  revenueLast30d: z.number(),
  revenueAllTime: z.number(),
  utilizationLast30Days: z.array(dailyUtilizationSchema),
})
export type VehicleDetailResponse = z.infer<typeof vehicleDetailResponseSchema>

/**
 * Minimal class option for the Add/Edit form's class dropdown. The `/manage`
 * endpoint returns full class rows; the extra fields are stripped (Zod objects
 * are non-strict by default), keeping this client's projection narrow.
 */
export const vehicleClassOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type VehicleClassOption = z.infer<typeof vehicleClassOptionSchema>

export const vehicleClassOptionsListSchema = z.array(vehicleClassOptionSchema)

/**
 * Minimal pickup-location option for the Add/Edit form's location dropdown
 * (#1262). Fed by the session-scoped `/locations` list; `status` is carried so
 * the form can offer only ACTIVE locations while still preserving a
 * since-archived assigned location as a labelled fallback (mirrors the archived
 * "Current class" behaviour). Extra location fields are stripped by Zod.
 */
export const pickupLocationOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(LOCATION_STATUSES),
})
export type PickupLocationOption = z.infer<typeof pickupLocationOptionSchema>

export const pickupLocationOptionsListSchema = z.array(pickupLocationOptionSchema)
