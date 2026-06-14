import type { BookingFulfillmentMode, BookingStatus, FeeType, FeeUnit } from './schema'

// ---- Slice 6 (#392) booking snapshot + event payload types ----
// Snapshots lock rates at booking time; operator edits to the live
// insurance_options / fee_schedules rows never rewrite a booked snapshot.
// Extracted from schema.ts to keep that file under the 800-line cap (#460).

export type InsuranceSnapshot = {
  insuranceOptionId: string
  name: string
  dailyPriceJpy: number
  deductibleJpy: number | null
}

export type FeeSnapshotItem = {
  feeType: FeeType
  unit: FeeUnit
  amountJpy: number
  // Provenance: class-specific (the class id) vs operator-wide (null).
  vehicleClassId: string | null
}

// A paid add-on locked onto the booking at submit (#460). priceJpy is the flat
// per-booking charge captured at booking time (rate-at-time-of-booking).
export type AddOnSnapshot = {
  addOnId: string
  name: string
  priceJpy: number
}

export type BookingCreatedPayload = {
  type: 'BOOKING_CREATED'
  requestedVehicleId: string
  assignedVehicleId: string
  classId: string
  // #463: the discriminator is a defining booking attribute, so the self-contained
  // CREATED audit snapshot records it alongside the vehicle/class it mirrors.
  fulfillmentMode: BookingFulfillmentMode
  startAt: string
  endAt: string
  totalPrice: number
  insuranceSnapshot: InsuranceSnapshot | null
  feeSnapshot: FeeSnapshotItem[]
  addOnSnapshot: AddOnSnapshot[]
}
export type VehicleSubstitutedPayload = {
  type: 'VEHICLE_SUBSTITUTED'
  fromVehicleId: string
  toVehicleId: string
  reason: string | null
}
export type BookingCancelledPayload = {
  type: 'BOOKING_CANCELLED'
  cancellationFee: number | null
  cancelledAt: string
}
export type StatusChangedPayload = {
  type: 'STATUS_CHANGED'
  from: BookingStatus
  to: BookingStatus
}
// #716: discriminated union keyed on `type`. The literals mirror BOOKING_EVENT_TYPES
// (booking_events.type is the storage-side discriminant), so consumers narrow on
// payload.type with zero casts and gain assertNever exhaustiveness. The read mapper
// (toBookingEvent) backfills the discriminant for legacy rows whose stored jsonb
// payload predates it.
export type BookingEventPayload =
  | BookingCreatedPayload
  | VehicleSubstitutedPayload
  | BookingCancelledPayload
  | StatusChangedPayload
