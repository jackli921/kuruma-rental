import type { Column } from 'drizzle-orm'
import type { getDb, RunTx } from '@kuruma/shared/db'
import {
  addOnOptions,
  addOnTemplates,
  bookingEvents,
  bookings,
  classRatePlans,
  insuranceOptions,
  feeSchedules,
  locations,
  maintenanceLogs,
  messages,
  paymentAnomalies,
  paymentEvents,
  paymentRefunds,
  reviews,
  threadParticipants,
  threads,
  vehicleBlocks,
  vehicleClasses,
  vehicles,
} from '@kuruma/shared/db/schema'
import type { BookingEventPayload } from '@kuruma/shared/db/schema'
import type { VehicleDetailBooking } from '@kuruma/shared/types/vehicle-detail'
import type { LocalizedText } from '@kuruma/shared/i18n/localized-text'
import type {
  AddOn,
  AddOnWithTemplate,
  Booking,
  BookingEvent,
  ClassRatePlan,
  InsuranceOption,
  FeeSchedule,
  Location,
  MaintenanceLog,
  Message,
  PaymentAnomaly,
  PaymentEvent,
  PaymentRefund,
  Review,
  Thread,
  ThreadParticipant,
  Vehicle,
  VehicleBlock,
  VehicleClass,
} from '../../stores'

export type Db = ReturnType<typeof getDb>

// The interactive-transaction handle drizzle hands the runTx callback (#493),
// derived from the same source so it tracks the driver type.
type TxClient = Parameters<Parameters<RunTx>[0]>[0]

/**
 * The single sanctioned bridge from an interactive-tx handle to the repo-facing
 * `Db` type (#733). Drizzle's tx exposes the same query-builder surface
 * (select/insert/update/delete) as `Db`; the two driver types differ only in
 * their result HKT (see `runTx`), so this `as unknown as Db` is the ONE place
 * the unsafe seam lives. Repos use only those methods — if `Db` ever gains one
 * `tx` lacks (e.g. nested transactions) this fails at runtime; revisit if
 * Drizzle ships a Transaction utility type.
 */
export function asTxDb(tx: TxClient): Db {
  return tx as unknown as Db
}

export const vehicleClassColumns = {
  id: vehicleClasses.id,
  operatorId: vehicleClasses.operatorId,
  name: vehicleClasses.name,
  slug: vehicleClasses.slug,
  description: vehicleClasses.description,
  photos: vehicleClasses.photos,
  seats: vehicleClasses.seats,
  luggageCapacity: vehicleClasses.luggageCapacity,
  luggageSize: vehicleClasses.luggageSize,
  transmission: vehicleClasses.transmission,
  fuelType: vehicleClasses.fuelType,
  acrissCode: vehicleClasses.acrissCode,
  sortOrder: vehicleClasses.sortOrder,
  status: vehicleClasses.status,
  createdAt: vehicleClasses.createdAt,
  updatedAt: vehicleClasses.updatedAt,
}

export const vehicleColumns = {
  id: vehicles.id,
  operatorId: vehicles.operatorId,
  classId: vehicles.classId,
  pickupLocationId: vehicles.pickupLocationId,
  name: vehicles.name,
  description: vehicles.description,
  photos: vehicles.photos,
  seats: vehicles.seats,
  luggageCapacity: vehicles.luggageCapacity,
  luggageSize: vehicles.luggageSize,
  transmission: vehicles.transmission,
  fuelType: vehicles.fuelType,
  licensePlate: vehicles.licensePlate,
  status: vehicles.status,
  minRentalHours: vehicles.minRentalHours,
  maxRentalHours: vehicles.maxRentalHours,
  advanceBookingHours: vehicles.advanceBookingHours,
  make: vehicles.make,
  model: vehicles.model,
  year: vehicles.year,
  color: vehicles.color,
  dailyRateJpy: vehicles.dailyRateJpy,
  hourlyRateJpy: vehicles.hourlyRateJpy,
  shakenExpiryDate: vehicles.shakenExpiryDate,
  insuranceExpiryDate: vehicles.insuranceExpiryDate,
  createdAt: vehicles.createdAt,
  updatedAt: vehicles.updatedAt,
}

export const locationColumns = {
  id: locations.id,
  operatorId: locations.operatorId,
  name: locations.name,
  address: locations.address,
  latitude: locations.latitude,
  longitude: locations.longitude,
  coordinateSource: locations.coordinateSource,
  operatingHours: locations.operatingHours,
  timezone: locations.timezone,
  defaultTurnaroundMinutes: locations.defaultTurnaroundMinutes,
  regionId: locations.regionId,
  status: locations.status,
  createdAt: locations.createdAt,
  updatedAt: locations.updatedAt,
}

export const insuranceOptionColumns = {
  id: insuranceOptions.id,
  operatorId: insuranceOptions.operatorId,
  name: insuranceOptions.name,
  description: insuranceOptions.description,
  dailyPriceJpy: insuranceOptions.dailyPriceJpy,
  deductibleJpy: insuranceOptions.deductibleJpy,
  status: insuranceOptions.status,
  createdAt: insuranceOptions.createdAt,
  updatedAt: insuranceOptions.updatedAt,
}

export const addOnOptionColumns = {
  id: addOnOptions.id,
  operatorId: addOnOptions.operatorId,
  name: addOnOptions.name,
  description: addOnOptions.description,
  templateId: addOnOptions.templateId,
  descriptionOverride: addOnOptions.descriptionOverride,
  priceJpy: addOnOptions.priceJpy,
  status: addOnOptions.status,
  createdAt: addOnOptions.createdAt,
  updatedAt: addOnOptions.updatedAt,
}

// Catalog i18n (slice 2): the add-on row columns PLUS the LEFT JOIN
// add_on_templates name/description bundles. Both template columns come back
// null for a legacy null-templateId row (no join match) — resolution falls back
// to the `name`/`description` columns then. Kept separate from
// addOnOptionColumns so writes (`.returning()` off the base table) stay simple.
export const addOnWithTemplateColumns = {
  ...addOnOptionColumns,
  templateName: addOnTemplates.name,
  templateDescription: addOnTemplates.description,
}

export const feeScheduleColumns = {
  id: feeSchedules.id,
  operatorId: feeSchedules.operatorId,
  vehicleClassId: feeSchedules.vehicleClassId,
  feeType: feeSchedules.feeType,
  unit: feeSchedules.unit,
  amountJpy: feeSchedules.amountJpy,
  status: feeSchedules.status,
  createdAt: feeSchedules.createdAt,
  updatedAt: feeSchedules.updatedAt,
}
export const classRatePlanColumns = {
  id: classRatePlans.id,
  operatorId: classRatePlans.operatorId,
  classId: classRatePlans.classId,
  pickupLocationId: classRatePlans.pickupLocationId,
  dayRateJpy: classRatePlans.dayRateJpy,
  isActive: classRatePlans.isActive,
  label: classRatePlans.label,
  createdAt: classRatePlans.createdAt,
  updatedAt: classRatePlans.updatedAt,
}
export const paymentEventColumns = {
  id: paymentEvents.id,
  operatorId: paymentEvents.operatorId,
  bookingId: paymentEvents.bookingId,
  stripeEventId: paymentEvents.stripeEventId,
  stripeCheckoutSessionId: paymentEvents.stripeCheckoutSessionId,
  stripePaymentIntentId: paymentEvents.stripePaymentIntentId,
  grossJpy: paymentEvents.grossJpy,
  platformFeeJpy: paymentEvents.platformFeeJpy,
  netToPartnerJpy: paymentEvents.netToPartnerJpy,
  currency: paymentEvents.currency,
  status: paymentEvents.status,
  createdAt: paymentEvents.createdAt,
}
export const paymentRefundColumns = {
  id: paymentRefunds.id,
  bookingId: paymentRefunds.bookingId,
  operatorId: paymentRefunds.operatorId,
  stripePaymentIntentId: paymentRefunds.stripePaymentIntentId,
  stripeRefundId: paymentRefunds.stripeRefundId,
  amountJpy: paymentRefunds.amountJpy,
  status: paymentRefunds.status,
  createdAt: paymentRefunds.createdAt,
  updatedAt: paymentRefunds.updatedAt,
}
export const reviewColumns = {
  id: reviews.id,
  bookingId: reviews.bookingId,
  operatorId: reviews.operatorId,
  authorUserId: reviews.authorUserId,
  authorRole: reviews.authorRole,
  subject: reviews.subject,
  subjectVehicleId: reviews.subjectVehicleId,
  subjectClassId: reviews.subjectClassId,
  overall: reviews.overall,
  subRatings: reviews.subRatings,
  comment: reviews.comment,
  moderationStatus: reviews.moderationStatus,
  revealDeadlineAt: reviews.revealDeadlineAt,
  submittedAt: reviews.submittedAt,
  publishedAt: reviews.publishedAt,
  createdAt: reviews.createdAt,
  updatedAt: reviews.updatedAt,
}

export const paymentAnomalyColumns = {
  id: paymentAnomalies.id,
  operatorId: paymentAnomalies.operatorId,
  bookingId: paymentAnomalies.bookingId,
  kind: paymentAnomalies.kind,
  stripeEventId: paymentAnomalies.stripeEventId,
  stripeCheckoutSessionId: paymentAnomalies.stripeCheckoutSessionId,
  stripePaymentIntentId: paymentAnomalies.stripePaymentIntentId,
  receivedAmountJpy: paymentAnomalies.receivedAmountJpy,
  expectedAmountJpy: paymentAnomalies.expectedAmountJpy,
  currency: paymentAnomalies.currency,
  resolvedAt: paymentAnomalies.resolvedAt,
  resolution: paymentAnomalies.resolution,
  resolvedBy: paymentAnomalies.resolvedBy,
  note: paymentAnomalies.note,
  createdAt: paymentAnomalies.createdAt,
}

export const bookingColumns = {
  id: bookings.id,
  operatorId: bookings.operatorId,
  renterId: bookings.renterId,
  classId: bookings.classId,
  requestedVehicleId: bookings.requestedVehicleId,
  assignedVehicleId: bookings.assignedVehicleId,
  pickupLocationId: bookings.pickupLocationId,
  dropoffLocationId: bookings.dropoffLocationId,
  startAt: bookings.startAt,
  endAt: bookings.endAt,
  effectiveEndAt: bookings.effectiveEndAt,
  status: bookings.status,
  source: bookings.source,
  fulfillmentMode: bookings.fulfillmentMode,
  bookingCode: bookings.bookingCode,
  insuranceOptionId: bookings.insuranceOptionId,
  insuranceSnapshot: bookings.insuranceSnapshot,
  feeSnapshot: bookings.feeSnapshot,
  addOnSnapshot: bookings.addOnSnapshot,
  externalId: bookings.externalId,
  notes: bookings.notes,
  totalPrice: bookings.totalPrice,
  cancellationFee: bookings.cancellationFee,
  cancellationFeeSettlement: bookings.cancellationFeeSettlement,
  cancelledAt: bookings.cancelledAt,
  idempotencyKey: bookings.idempotencyKey,
  disclaimerAcknowledgedAt: bookings.disclaimerAcknowledgedAt,
  disclaimerTermsVersion: bookings.disclaimerTermsVersion,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
}

export const bookingEventColumns = {
  id: bookingEvents.id,
  bookingId: bookingEvents.bookingId,
  type: bookingEvents.type,
  payload: bookingEvents.payload,
  actorId: bookingEvents.actorId,
  createdAt: bookingEvents.createdAt,
}

// Explicit column lists. Following the pattern in DrizzleVehicleRepository
// (and the rule from issue #19 — never SELECT *) so adding a column to the
// schema can never silently leak into API responses.
export const threadColumns = {
  id: threads.id,
  bookingId: threads.bookingId,
  operatorId: threads.operatorId,
  operatorUnreadCount: threads.operatorUnreadCount,
  idempotencyKey: threads.idempotencyKey,
  createdAt: threads.createdAt,
  updatedAt: threads.updatedAt,
}

export const participantColumns = {
  id: threadParticipants.id,
  threadId: threadParticipants.threadId,
  userId: threadParticipants.userId,
  unreadCount: threadParticipants.unreadCount,
}

export const messageColumns = {
  id: messages.id,
  threadId: messages.threadId,
  senderId: messages.senderId,
  content: messages.content,
  sourceLanguage: messages.sourceLanguage,
  translations: messages.translations,
  idempotencyKey: messages.idempotencyKey,
  createdAt: messages.createdAt,
}

export const maintenanceLogColumns = {
  id: maintenanceLogs.id,
  vehicleId: maintenanceLogs.vehicleId,
  reason: maintenanceLogs.reason,
  notes: maintenanceLogs.notes,
  costJpy: maintenanceLogs.costJpy,
  startedAt: maintenanceLogs.startedAt,
  resolvedAt: maintenanceLogs.resolvedAt,
  createdAt: maintenanceLogs.createdAt,
  updatedAt: maintenanceLogs.updatedAt,
}

export const vehicleBlockColumns = {
  id: vehicleBlocks.id,
  operatorId: vehicleBlocks.operatorId,
  vehicleId: vehicleBlocks.vehicleId,
  startAt: vehicleBlocks.startAt,
  endAt: vehicleBlocks.endAt,
  kind: vehicleBlocks.kind,
  reason: vehicleBlocks.reason,
  notes: vehicleBlocks.notes,
  createdBy: vehicleBlocks.createdBy,
  createdAt: vehicleBlocks.createdAt,
}

// --- Shared date/time helpers ---

export function overlapHours(
  bookingStart: Date,
  bookingEnd: Date,
  windowStart: Date,
  windowEnd: Date,
): number {
  const start = bookingStart < windowStart ? windowStart : bookingStart
  const end = bookingEnd > windowEnd ? windowEnd : bookingEnd
  if (end <= start) return 0
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60)
}

// --- Row-to-domain mappers ---
// Drizzle infers wider types than our domain interfaces (e.g. `string`
// instead of `'AUTO' | 'MANUAL'`). These mappers verify every field at
// the boundary. If a schema column is added to the domain type, the
// mapper fails to compile — unlike `as Type` which silently allows it.

// Derives the query-result shape from a Drizzle column selection object.
// Each column's `_` metadata carries its data type and nullability.
type ColumnRow<T extends Record<string, Column>> = {
  [K in keyof T]: T[K]['_']['notNull'] extends true ? T[K]['_']['data'] : T[K]['_']['data'] | null
}

type VehicleClassRow = ColumnRow<typeof vehicleClassColumns>
type VehicleRow = ColumnRow<typeof vehicleColumns>
type LocationRow = ColumnRow<typeof locationColumns>
type InsuranceOptionRow = ColumnRow<typeof insuranceOptionColumns>
type AddOnOptionRow = ColumnRow<typeof addOnOptionColumns>
// ColumnRow can't express LEFT-JOIN nullability (add_on_templates.name is NOT
// NULL as a column, but null when the join misses), so widen the two joined
// bundles to `| null` by hand.
type AddOnWithTemplateRow = AddOnOptionRow & {
  templateName: LocalizedText | null
  templateDescription: LocalizedText | null
}
type FeeScheduleRow = ColumnRow<typeof feeScheduleColumns>
type ClassRatePlanRow = ColumnRow<typeof classRatePlanColumns>
type PaymentEventRow = ColumnRow<typeof paymentEventColumns>
type PaymentRefundRow = ColumnRow<typeof paymentRefundColumns>
type PaymentAnomalyRow = ColumnRow<typeof paymentAnomalyColumns>
type ReviewRow = ColumnRow<typeof reviewColumns>
type BookingRow = ColumnRow<typeof bookingColumns>
type BookingEventRow = ColumnRow<typeof bookingEventColumns>
type ThreadRow = ColumnRow<typeof threadColumns>
type ThreadParticipantRow = ColumnRow<typeof participantColumns>
type MaintenanceLogRow = ColumnRow<typeof maintenanceLogColumns>
type VehicleBlockRow = ColumnRow<typeof vehicleBlockColumns>

/**
 * Decodes stored `photos` entries to wire URLs (#879). The composition root
 * builds the real decoder from `VEHICLE_PHOTOS_PUBLIC_URL` (r2:<key> -> URL,
 * external URLs pass through) and injects it into the read-serving repos;
 * `identityPhotoDecoder` is the no-op fallback for paths that never carry r2:
 * refs (the in-memory repos store domain objects directly; the tx-bound vehicle
 * repo reads for consistency, not photo serving).
 */
export type PhotoDecoder = (photos: readonly string[]) => string[]

export const identityPhotoDecoder: PhotoDecoder = (photos) => [...photos]

/**
 * Encodes wire-URL `photos` entries to their stored form (#879) — the write-side
 * inverse of {@link PhotoDecoder}. The composition root builds the real encoder
 * from `VEHICLE_PHOTOS_PUBLIC_URL` (our public URL -> r2:<key>, external URLs
 * pass through) and injects it into the photo-writing repos (vehicle +
 * vehicle-class). `identityPhotoEncoder` is the no-op default for paths that
 * never mint r2: refs (the in-memory repos store domain objects directly; the
 * tx-bound vehicle repo never writes photos). Keeping encode here means r2:
 * refs are minted in exactly one place — symmetric with decode on read.
 */
export type PhotoEncoder = (photos: readonly string[]) => string[]

export const identityPhotoEncoder: PhotoEncoder = (photos) => [...photos]

export function toVehicleClass(r: VehicleClassRow, decodePhotos: PhotoDecoder): VehicleClass {
  return {
    id: r.id,
    operatorId: r.operatorId,
    name: r.name,
    slug: r.slug,
    description: r.description,
    photos: decodePhotos(r.photos),
    seats: r.seats,
    luggageCapacity: r.luggageCapacity,
    luggageSize: r.luggageSize,
    transmission: r.transmission,
    fuelType: r.fuelType,
    acrissCode: r.acrissCode,
    sortOrder: r.sortOrder,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toLocation(r: LocationRow): Location {
  return {
    id: r.id,
    operatorId: r.operatorId,
    name: r.name,
    address: r.address,
    latitude: r.latitude,
    longitude: r.longitude,
    coordinateSource: r.coordinateSource,
    operatingHours: r.operatingHours,
    timezone: r.timezone,
    defaultTurnaroundMinutes: r.defaultTurnaroundMinutes,
    regionId: r.regionId,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toInsuranceOption(r: InsuranceOptionRow): InsuranceOption {
  return {
    id: r.id,
    operatorId: r.operatorId,
    name: r.name,
    description: r.description,
    dailyPriceJpy: r.dailyPriceJpy,
    deductibleJpy: r.deductibleJpy,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toAddOn(r: AddOnOptionRow): AddOn {
  return {
    id: r.id,
    operatorId: r.operatorId,
    name: r.name,
    description: r.description,
    templateId: r.templateId,
    descriptionOverride: r.descriptionOverride,
    priceJpy: r.priceJpy,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toAddOnWithTemplate(r: AddOnWithTemplateRow): AddOnWithTemplate {
  return {
    ...toAddOn(r),
    templateName: r.templateName,
    templateDescription: r.templateDescription,
  }
}

export function toFeeSchedule(r: FeeScheduleRow): FeeSchedule {
  return {
    id: r.id,
    operatorId: r.operatorId,
    vehicleClassId: r.vehicleClassId,
    feeType: r.feeType,
    unit: r.unit,
    amountJpy: r.amountJpy,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toClassRatePlan(r: ClassRatePlanRow): ClassRatePlan {
  return {
    id: r.id,
    operatorId: r.operatorId,
    classId: r.classId,
    pickupLocationId: r.pickupLocationId,
    dayRateJpy: r.dayRateJpy,
    isActive: r.isActive,
    label: r.label,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toPaymentEvent(r: PaymentEventRow): PaymentEvent {
  return {
    id: r.id,
    operatorId: r.operatorId,
    bookingId: r.bookingId,
    stripeEventId: r.stripeEventId,
    stripeCheckoutSessionId: r.stripeCheckoutSessionId,
    stripePaymentIntentId: r.stripePaymentIntentId,
    grossJpy: r.grossJpy,
    platformFeeJpy: r.platformFeeJpy,
    netToPartnerJpy: r.netToPartnerJpy,
    currency: r.currency,
    status: r.status,
    createdAt: r.createdAt,
  }
}

export function toPaymentRefund(r: PaymentRefundRow): PaymentRefund {
  return {
    id: r.id,
    bookingId: r.bookingId,
    operatorId: r.operatorId,
    stripePaymentIntentId: r.stripePaymentIntentId,
    stripeRefundId: r.stripeRefundId,
    amountJpy: r.amountJpy,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    bookingId: r.bookingId,
    operatorId: r.operatorId,
    authorUserId: r.authorUserId,
    authorRole: r.authorRole,
    subject: r.subject,
    subjectVehicleId: r.subjectVehicleId,
    subjectClassId: r.subjectClassId,
    overall: r.overall,
    subRatings: r.subRatings,
    comment: r.comment,
    moderationStatus: r.moderationStatus,
    revealDeadlineAt: r.revealDeadlineAt,
    submittedAt: r.submittedAt,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toPaymentAnomaly(r: PaymentAnomalyRow): PaymentAnomaly {
  return {
    id: r.id,
    operatorId: r.operatorId,
    bookingId: r.bookingId,
    kind: r.kind,
    stripeEventId: r.stripeEventId,
    stripeCheckoutSessionId: r.stripeCheckoutSessionId,
    stripePaymentIntentId: r.stripePaymentIntentId,
    receivedAmountJpy: r.receivedAmountJpy,
    expectedAmountJpy: r.expectedAmountJpy,
    currency: r.currency,
    resolvedAt: r.resolvedAt,
    resolution: r.resolution,
    resolvedBy: r.resolvedBy,
    note: r.note,
    createdAt: r.createdAt,
  }
}

export function toVehicle(r: VehicleRow, decodePhotos: PhotoDecoder): Vehicle {
  return {
    id: r.id,
    operatorId: r.operatorId,
    classId: r.classId,
    pickupLocationId: r.pickupLocationId,
    name: r.name,
    description: r.description,
    photos: decodePhotos(r.photos),
    seats: r.seats,
    luggageCapacity: r.luggageCapacity,
    luggageSize: r.luggageSize,
    transmission: r.transmission,
    fuelType: r.fuelType,
    licensePlate: r.licensePlate,
    status: r.status,
    minRentalHours: r.minRentalHours,
    maxRentalHours: r.maxRentalHours,
    advanceBookingHours: r.advanceBookingHours,
    make: r.make,
    model: r.model,
    year: r.year,
    color: r.color,
    dailyRateJpy: r.dailyRateJpy,
    hourlyRateJpy: r.hourlyRateJpy,
    shakenExpiryDate: r.shakenExpiryDate,
    insuranceExpiryDate: r.insuranceExpiryDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    operatorId: r.operatorId,
    renterId: r.renterId,
    classId: r.classId,
    requestedVehicleId: r.requestedVehicleId,
    assignedVehicleId: r.assignedVehicleId,
    pickupLocationId: r.pickupLocationId,
    dropoffLocationId: r.dropoffLocationId,
    startAt: r.startAt,
    endAt: r.endAt,
    effectiveEndAt: r.effectiveEndAt,
    status: r.status,
    source: r.source,
    fulfillmentMode: r.fulfillmentMode,
    bookingCode: r.bookingCode,
    insuranceOptionId: r.insuranceOptionId,
    insuranceSnapshot: r.insuranceSnapshot,
    feeSnapshot: r.feeSnapshot,
    addOnSnapshot: r.addOnSnapshot,
    externalId: r.externalId,
    notes: r.notes,
    totalPrice: r.totalPrice,
    cancellationFee: r.cancellationFee,
    cancellationFeeSettlement: r.cancellationFeeSettlement,
    cancelledAt: r.cancelledAt,
    idempotencyKey: r.idempotencyKey,
    disclaimerAcknowledgedAt: r.disclaimerAcknowledgedAt,
    disclaimerTermsVersion: r.disclaimerTermsVersion,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toBookingEvent(r: BookingEventRow): BookingEvent {
  return {
    id: r.id,
    bookingId: r.bookingId,
    type: r.type,
    // #716: the `type` column is authoritative; backfill it into the discriminated
    // payload so rows whose stored jsonb predates the embedded discriminant still
    // narrow on payload.type.
    payload: { ...r.payload, type: r.type } as BookingEventPayload,
    actorId: r.actorId,
    createdAt: r.createdAt,
  }
}

export function toThread(r: ThreadRow): Thread {
  return {
    id: r.id,
    bookingId: r.bookingId,
    operatorId: r.operatorId ?? null,
    operatorUnreadCount: r.operatorUnreadCount,
    idempotencyKey: r.idempotencyKey ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toThreadParticipant(r: ThreadParticipantRow): ThreadParticipant {
  return {
    id: r.id,
    threadId: r.threadId,
    userId: r.userId,
    unreadCount: r.unreadCount,
  }
}

export function toMaintenanceLog(r: MaintenanceLogRow): MaintenanceLog {
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    reason: r.reason,
    notes: r.notes,
    costJpy: r.costJpy,
    startedAt: r.startedAt,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toVehicleBlock(r: VehicleBlockRow): VehicleBlock {
  return {
    id: r.id,
    operatorId: r.operatorId,
    vehicleId: r.vehicleId,
    startAt: r.startAt,
    endAt: r.endAt,
    kind: r.kind,
    reason: r.reason,
    notes: r.notes,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }
}

// VehicleDetailBooking — narrow upcoming-bookings rows. Drizzle infers
// `source`/`status` as `string`; the DB enum values are a superset of the
// two used here (status is filtered to CONFIRMED | ACTIVE at query time).
// This validates the contract at the boundary instead of using `as`, which
// would silently let wider values through (e.g. if the query filter is ever
// relaxed). A row outside the union is an operator bug or data corruption —
// fail loudly.
const VEHICLE_DETAIL_BOOKING_SOURCES = ['DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER'] as const
const VEHICLE_DETAIL_BOOKING_STATUSES = ['CONFIRMED', 'ACTIVE'] as const

type VehicleDetailBookingSource = (typeof VEHICLE_DETAIL_BOOKING_SOURCES)[number]
type VehicleDetailBookingStatus = (typeof VEHICLE_DETAIL_BOOKING_STATUSES)[number]

export type VehicleDetailBookingRow = {
  id: string
  startAt: Date
  endAt: Date
  source: string
  status: string
  renterName: string | null
}

function isVehicleDetailSource(v: string): v is VehicleDetailBookingSource {
  return (VEHICLE_DETAIL_BOOKING_SOURCES as readonly string[]).includes(v)
}

function isVehicleDetailStatus(v: string): v is VehicleDetailBookingStatus {
  return (VEHICLE_DETAIL_BOOKING_STATUSES as readonly string[]).includes(v)
}

export function toVehicleDetailBooking(r: VehicleDetailBookingRow): VehicleDetailBooking {
  if (!isVehicleDetailSource(r.source)) {
    throw new Error(`Invalid booking source for vehicle detail: ${r.source} (id=${r.id})`)
  }
  if (!isVehicleDetailStatus(r.status)) {
    throw new Error(`Invalid booking status for vehicle detail: ${r.status} (id=${r.id})`)
  }
  return {
    id: r.id,
    startAt: r.startAt,
    endAt: r.endAt,
    renterName: r.renterName,
    source: r.source,
    status: r.status,
  }
}

// Raw row shape returned by message queries. Extracted because it appears in
// normaliseMessage, the DISTINCT ON raw-SQL result, and the neon-http coercion.
export type RawMessageRow = {
  id: string
  threadId: string
  senderId: string
  content: string
  sourceLanguage: string | null
  translations: Record<string, string>
  idempotencyKey: string | null
  createdAt: Date
}

// `messages.translations` is a jsonb column (notNull, default {}), so the
// driver returns a parsed object — pass it straight through, no sentinel.
export function normaliseMessage(row: RawMessageRow): Message {
  return {
    id: row.id,
    threadId: row.threadId,
    senderId: row.senderId,
    content: row.content,
    sourceLanguage: row.sourceLanguage,
    translations: row.translations,
    idempotencyKey: row.idempotencyKey ?? null,
    createdAt: row.createdAt,
  }
}
