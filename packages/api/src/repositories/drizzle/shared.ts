import type { getDb } from '@kuruma/shared/db'
import {
  bookings,
  maintenanceLogs,
  messages,
  threadParticipants,
  threads,
  vehicles,
} from '@kuruma/shared/db/schema'
import type { Booking, MaintenanceLog, Message, Thread, ThreadParticipant, Vehicle } from '../../stores'

export type Db = ReturnType<typeof getDb>

export const vehicleColumns = {
  id: vehicles.id,
  name: vehicles.name,
  description: vehicles.description,
  photos: vehicles.photos,
  seats: vehicles.seats,
  transmission: vehicles.transmission,
  fuelType: vehicles.fuelType,
  licensePlate: vehicles.licensePlate,
  status: vehicles.status,
  bufferMinutes: vehicles.bufferMinutes,
  minRentalHours: vehicles.minRentalHours,
  maxRentalHours: vehicles.maxRentalHours,
  advanceBookingHours: vehicles.advanceBookingHours,
  dailyRateJpy: vehicles.dailyRateJpy,
  hourlyRateJpy: vehicles.hourlyRateJpy,
  shakenExpiryDate: vehicles.shakenExpiryDate,
  insuranceExpiryDate: vehicles.insuranceExpiryDate,
  createdAt: vehicles.createdAt,
  updatedAt: vehicles.updatedAt,
}

export const bookingColumns = {
  id: bookings.id,
  renterId: bookings.renterId,
  vehicleId: bookings.vehicleId,
  startAt: bookings.startAt,
  endAt: bookings.endAt,
  effectiveEndAt: bookings.effectiveEndAt,
  status: bookings.status,
  source: bookings.source,
  externalId: bookings.externalId,
  notes: bookings.notes,
  totalPrice: bookings.totalPrice,
  cancellationFee: bookings.cancellationFee,
  cancelledAt: bookings.cancelledAt,
  idempotencyKey: bookings.idempotencyKey,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
}

// Explicit column lists. Following the pattern in DrizzleVehicleRepository
// (and the rule from issue #19 — never SELECT *) so adding a column to the
// schema can never silently leak into API responses.
export const threadColumns = {
  id: threads.id,
  bookingId: threads.bookingId,
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

// --- Row-to-domain mappers ---
// Drizzle infers wider types than our domain interfaces (e.g. `string`
// instead of `'AUTO' | 'MANUAL'`). These mappers verify every field at
// the boundary. If a schema column is added to the domain type, the
// mapper fails to compile — unlike `as Type` which silently allows it.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle row types vary
type AnyRow = Record<string, any>

export function toVehicle(r: AnyRow): Vehicle {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    photos: r.photos,
    seats: r.seats,
    transmission: r.transmission,
    fuelType: r.fuelType,
    licensePlate: r.licensePlate,
    status: r.status,
    bufferMinutes: r.bufferMinutes,
    minRentalHours: r.minRentalHours,
    maxRentalHours: r.maxRentalHours,
    advanceBookingHours: r.advanceBookingHours,
    dailyRateJpy: r.dailyRateJpy,
    hourlyRateJpy: r.hourlyRateJpy,
    shakenExpiryDate: r.shakenExpiryDate,
    insuranceExpiryDate: r.insuranceExpiryDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toBooking(r: AnyRow): Booking {
  return {
    id: r.id,
    renterId: r.renterId,
    vehicleId: r.vehicleId,
    startAt: r.startAt,
    endAt: r.endAt,
    effectiveEndAt: r.effectiveEndAt,
    status: r.status,
    source: r.source,
    externalId: r.externalId,
    notes: r.notes,
    totalPrice: r.totalPrice,
    cancellationFee: r.cancellationFee,
    cancelledAt: r.cancelledAt,
    idempotencyKey: r.idempotencyKey,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toThread(r: AnyRow): Thread {
  return {
    id: r.id,
    bookingId: r.bookingId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function toThreadParticipant(r: AnyRow): ThreadParticipant {
  return {
    id: r.id,
    threadId: r.threadId,
    userId: r.userId,
    unreadCount: r.unreadCount,
  }
}

export function toMaintenanceLog(r: AnyRow): MaintenanceLog {
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

// Raw row shape returned by message queries. Extracted because it appears in
// normaliseMessage, the DISTINCT ON raw-SQL result, and the neon-http coercion.
export type RawMessageRow = {
  id: string
  threadId: string
  senderId: string
  content: string
  sourceLanguage: string | null
  translations: string | null
  createdAt: Date
}

// `messages.translations` is a nullable text column with a default of '{}'.
// The shared `Message` type declares it as `string` (non-null), so we
// normalise NULL -> '{}' at the boundary rather than leak the DB nuance.
export function normaliseMessage(row: RawMessageRow): Message {
  return {
    id: row.id,
    threadId: row.threadId,
    senderId: row.senderId,
    content: row.content,
    sourceLanguage: row.sourceLanguage,
    translations: row.translations ?? '{}',
    createdAt: row.createdAt,
  }
}
