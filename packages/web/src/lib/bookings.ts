'use server'

import { auth } from '@/auth'
import { createApiClient } from '@/lib/api-client'
import { getApiToken } from '@/lib/api-token'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

type CreateBookingResult = { success: true; bookingId: string } | { success: false; error: string }

interface CreateClassBookingInput {
  classId: string
  startAt: string
  endAt: string
  notes?: string
}

// Issue #311: renters book a class, not a specific vehicle. The owner
// assigns a car from the class at pickup. The API accepts classId-only
// bookings (see createBookingSchema in shared/validators) and a 409
// Conflict here means "no cars in this class are free for these dates".
export async function createClassBooking(
  input: CreateClassBookingInput,
): Promise<CreateBookingResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in to make a booking.' }
  }

  if (!input.classId) {
    return { success: false, error: 'Vehicle class is required.' }
  }

  if (!input.startAt || !input.endAt) {
    return { success: false, error: 'Start and end dates are required.' }
  }

  if (new Date(input.endAt) <= new Date(input.startAt)) {
    return { success: false, error: 'End date must be after start date.' }
  }

  const token = await getApiToken()
  const client = createApiClient(token)
  const idempotencyKey = crypto.randomUUID()
  const res = await client.bookings.$post({
    json: {
      classId: input.classId,
      renterId: session.user.id,
      startAt: input.startAt,
      endAt: input.endAt,
      source: 'DIRECT',
      idempotencyKey,
      ...(input.notes ? { notes: input.notes } : {}),
    },
  })

  const json = (await res.json()) as { success: boolean; data?: { id: string }; error?: string }

  if (json.success && json.data) {
    return { success: true, bookingId: json.data.id }
  }

  if (res.status === 409) {
    return {
      success: false,
      error: 'No cars available for these dates. Please choose different dates.',
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
  const token = await getApiToken()
  const client = createApiClient(token)
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
  classId: string
  vehicleId: string | null
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
  const token = await getApiToken()
  const client = createApiClient(token)
  const res = await client.bookings[':id'].$get({ param: { id } })
  const json = (await res.json()) as ApiResponse<Booking>

  if (!json.success) return null

  return json.data
}
