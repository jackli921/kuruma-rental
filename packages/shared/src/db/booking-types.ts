import type {
  BookingFulfillmentMode,
  BookingStatus,
  CancellationReasonCode,
  FeeType,
  FeeUnit,
} from '../enums'
import type { Locale } from '../i18n/locales'

// ---- Slice 6 (#392) booking snapshot + event payload types ----
// Snapshots lock rates at booking time; operator edits to the live
// insurance_options / fee_schedules rows never rewrite a booked snapshot.
// Extracted from schema.ts to keep that file under the 800-line cap (#460).

export type InsuranceSnapshot = {
  insuranceOptionId: string
  name: string
  dailyPriceJpy: number
  deductibleJpy: number | null
  // Catalog i18n (slice 4 populates these; legacy snapshots omit them, hence
  // optional). templateId = the platform template the option resolved from (null
  // when the operator has no template link); nameLocale = the locale `name` was
  // captured in, so a reader in another locale can re-resolve from the template.
  templateId?: string | null
  nameLocale?: Locale
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
  // Catalog i18n (slice 4 populates these; legacy snapshots omit them, hence
  // optional). templateId = the platform template the add-on resolved from (null
  // when the operator has no template link); nameLocale = the locale `name` was
  // captured in, so a reader in another locale can re-resolve from the template.
  templateId?: string | null
  nameLocale?: Locale
}

export type BookingCreatedPayload = {
  type: 'BOOKING_CREATED'
  // #464: null on a CLASS_COMBO booking — the renter picks a class + location, the
  // operator assigns a concrete car later. SPECIFIC bookings always carry both ids
  // (enforced by the bookings_specific_requires_*_vehicle CHECK constraints in
  // packages/shared/src/db/booking.ts).
  requestedVehicleId: string | null
  assignedVehicleId: string | null
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
  // #464: null when a CLASS_COMBO float is assigned its first car via the
  // substitution path (null -> car, backfilling price per #429). Non-null for a
  // true car-to-car swap.
  fromVehicleId: string | null
  toVehicleId: string
  reason: string | null
}
// #868 Slice 3b: the optional renter-supplied reason, captured at cancel time and
// stored ONLY inside the BOOKING_CANCELLED event payload (no bookings column).
// `note` is a short freeform elaboration; `null` when the renter left it blank.
export type CancellationReason = {
  code: CancellationReasonCode
  note: string | null
}
export type BookingCancelledPayload = {
  type: 'BOOKING_CANCELLED'
  cancellationFee: number | null
  cancelledAt: string
  // #868 3b: null when the renter picked no reason. Legacy BOOKING_CANCELLED rows
  // predate this field and simply omit it from their stored jsonb — no consumer
  // reads it yet (the operator timeline shows only the fee), so the absence is
  // benign and treated the same as "no reason given".
  cancellationReason: CancellationReason | null
}
export type StatusChangedPayload = {
  type: 'STATUS_CHANGED'
  from: BookingStatus
  to: BookingStatus
}
// #464: operator assigns a concrete car to a CLASS_COMBO float (null -> car, or
// car -> car on a reassignment). Mirrors VehicleSubstitutedPayload but the price
// is intentionally NOT re-snapshotted — the class rate plan fixes it at submit.
export type VehicleAssignedPayload = {
  type: 'VEHICLE_ASSIGNED'
  fromVehicleId: string | null // null on first assign; the prior car on a swap
  toVehicleId: string
  reason: string | null
}
// #716: discriminated union keyed on `type`. The literals mirror BOOKING_EVENT_TYPES
// (booking_events.type is the storage-side discriminant), so consumers narrow on
// payload.type with zero casts and gain assertNever exhaustiveness. The read mapper
// (toBookingEvent) backfills the discriminant for legacy rows whose stored jsonb
// payload predates it.
export type BookingEventPayload =
  | BookingCreatedPayload
  | VehicleSubstitutedPayload
  | VehicleAssignedPayload
  | BookingCancelledPayload
  | StatusChangedPayload
