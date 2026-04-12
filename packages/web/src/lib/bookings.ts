'use server'

import { auth } from '@/auth'
import { getApiBaseUrl } from '@/lib/api-client'

interface CreateBookingInput {
  vehicleId: string
  startAt: string
  endAt: string
  notes?: string
}

// Structured rental-rule failure surfaced from the API. The form needs the
// exact `code` + `required` hours so it can render the same translated
// message as the inline client-side check (#65).
export type RentalRuleFailure = {
  code: 'RENTAL_RULE_ADVANCE_BOOKING' | 'RENTAL_RULE_MIN_DURATION' | 'RENTAL_RULE_MAX_DURATION'
  required: number
  actual: number
}

type CreateBookingResult =
  | { success: true; bookingId: string }
  | { success: false; error: string; rentalRule?: RentalRuleFailure }

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export async function checkAvailability(
  vehicleId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const base = getApiBaseUrl()
  const from = encodeURIComponent(startAt.toISOString())
  const to = encodeURIComponent(endAt.toISOString())
  const res = await fetch(
    `${base}/availability/${encodeURIComponent(vehicleId)}?from=${from}&to=${to}`,
  )
  const json: ApiResponse<{ available: boolean }> = await res.json()

  if (!json.success || !json.data) return false

  return json.data.available
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in to make a booking.' }
  }

  if (!input.vehicleId) {
    return { success: false, error: 'Vehicle ID is required.' }
  }

  if (!input.startAt || !input.endAt) {
    return { success: false, error: 'Start and end dates are required.' }
  }

  const startAt = new Date(input.startAt)
  const endAt = new Date(input.endAt)

  if (endAt <= startAt) {
    return { success: false, error: 'End date must be after start date.' }
  }

  const isAvailable = await checkAvailability(input.vehicleId, startAt, endAt)
  if (!isAvailable) {
    return {
      success: false,
      error: 'This vehicle is not available for the selected dates.',
    }
  }

  // Issue #84: generate a unique key per booking intent so network retries
  // don't create duplicate bookings. The server returns the original booking
  // if it sees the same key twice.
  const idempotencyKey = crypto.randomUUID()

  const base = getApiBaseUrl()
  const res = await fetch(`${base}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicleId: input.vehicleId,
      renterId: session.user.id,
      startAt: input.startAt,
      endAt: input.endAt,
      source: 'DIRECT',
      idempotencyKey,
      ...(input.notes ? { notes: input.notes } : {}),
    }),
  })
  // Parse as unknown so we can detect rental-rule error envelopes without
  // pretending every non-success response has the same shape.
  const json: {
    success: boolean
    data?: { id: string }
    error?: string
    code?: string
    details?: { required?: number; actual?: number }
  } = await res.json()

  if (json.success && json.data) {
    return { success: true, bookingId: json.data.id }
  }

  // Rental-rule rejections carry a known code so the client can translate.
  // Everything else gets a generic error string.
  if (
    json.code === 'RENTAL_RULE_ADVANCE_BOOKING' ||
    json.code === 'RENTAL_RULE_MIN_DURATION' ||
    json.code === 'RENTAL_RULE_MAX_DURATION'
  ) {
    return {
      success: false,
      error: json.error ?? 'Booking violates a rental rule',
      rentalRule: {
        code: json.code,
        required: json.details?.required ?? 0,
        actual: json.details?.actual ?? 0,
      },
    }
  }

  return { success: false, error: 'Failed to create booking.' }
}

export type BookingWithVehicle = {
  id: string
  vehicleId: string
  vehicleName: string
  vehiclePhoto: string | null
  startAt: string
  endAt: string
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  createdAt: string
}

interface BookingWithVehicleResponse {
  id: string
  vehicleId: string
  startAt: string
  endAt: string
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  createdAt: string
  vehicle?: {
    name: string
    photos: string[]
  }
}

export async function getBookingsByRenterId(userId: string): Promise<BookingWithVehicle[]> {
  const base = getApiBaseUrl()
  const res = await fetch(`${base}/bookings?renterId=${encodeURIComponent(userId)}&expand=vehicle`)
  const json: ApiResponse<BookingWithVehicleResponse[]> = await res.json()

  if (!json.success || !json.data) return []

  return json.data.map((booking) => ({
    id: booking.id,
    vehicleId: booking.vehicleId,
    vehicleName: booking.vehicle?.name ?? '',
    vehiclePhoto: booking.vehicle?.photos?.[0] ?? null,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
    createdAt: booking.createdAt,
  }))
}

interface Booking {
  id: string
  renterId: string
  vehicleId: string
  startAt: string
  endAt: string
  effectiveEndAt: string
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  source: string
  externalId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export async function getBookingById(id: string): Promise<Booking | null> {
  const base = getApiBaseUrl()
  const res = await fetch(`${base}/bookings/${encodeURIComponent(id)}`)
  const json: ApiResponse<Booking> = await res.json()

  if (!json.success || !json.data) return null

  return json.data
}
