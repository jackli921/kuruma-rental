import type { getDb } from '@kuruma/shared/db'
import {
  bookings,
  messages,
  threadParticipants,
  threads,
  vehicles,
} from '@kuruma/shared/db/schema'
import type { Message } from '../../stores'

export type Db = ReturnType<typeof getDb>

export const vehicleColumns = {
  id: vehicles.id,
  name: vehicles.name,
  description: vehicles.description,
  photos: vehicles.photos,
  seats: vehicles.seats,
  transmission: vehicles.transmission,
  fuelType: vehicles.fuelType,
  status: vehicles.status,
  bufferMinutes: vehicles.bufferMinutes,
  minRentalHours: vehicles.minRentalHours,
  maxRentalHours: vehicles.maxRentalHours,
  advanceBookingHours: vehicles.advanceBookingHours,
  dailyRateJpy: vehicles.dailyRateJpy,
  hourlyRateJpy: vehicles.hourlyRateJpy,
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
