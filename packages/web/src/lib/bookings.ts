'use server'

import { auth } from '@/auth'
import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

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

export async function checkAvailability(
  vehicleId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const client = createApiClient()
  // Query params read manually by parseDateRange() — not in Hono's type sig,
  // so we use $url() for typed path construction + fetch for query params.
  const url = client.availability[':vehicleId'].$url({ param: { vehicleId } })
  url.searchParams.set('from', startAt.toISOString())
  url.searchParams.set('to', endAt.toISOString())
  const res = await fetch(url)
  const json = (await res.json()) as ApiResponse<{ available: boolean }>

  if (!json.success) return false

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

  // Optimistic concurrency: skip the availability pre-check and let the DB
  // exclusion constraint be the authoritative guard. A separate check-then-act
  // round-trip adds latency and creates a race window where two users both
  // pass the check but only one succeeds at insert time. Handle the 409
  // (constraint violation) with a user-friendly message instead.
  const client = createApiClient()
  const idempotencyKey = crypto.randomUUID()
  const res = await client.bookings.$post({
    json: {
      vehicleId: input.vehicleId,
      renterId: session.user.id,
      startAt: input.startAt,
      endAt: input.endAt,
      source: 'DIRECT',
      idempotencyKey,
      ...(input.notes ? { notes: input.notes } : {}),
    },
  })

  const json = (await res.json()) as {
    success: boolean
    data?: { id: string }
    error?: string
    code?: string
    details?: { required?: number; actual?: number }
  }

  if (json.success && json.data) {
    return { success: true, bookingId: json.data.id }
  }

  // 409 Conflict — DB exclusion constraint rejected overlapping booking.
  if (res.status === 409) {
    return {
      success: false,
      error: 'This vehicle was just booked by another renter. Please choose different dates.',
    }
  }

  // Rental-rule rejections carry a known code so the client can translate.
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
  const client = createApiClient()
  const res = await client.bookings.$get({
    query: { renterId: userId, expand: 'vehicle' },
  })
  const json = (await res.json()) as ApiResponse<BookingWithVehicleResponse[]>

  if (!json.success) return []

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
  const client = createApiClient()
  const res = await client.bookings[':id'].$get({ param: { id } })
  const json = (await res.json()) as ApiResponse<Booking>

  if (!json.success) return null

  return json.data
}
