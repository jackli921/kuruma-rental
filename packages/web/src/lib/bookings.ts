'use server'

import { auth } from '@/auth'
import { createApiClient } from '@/lib/api-client'
import { getApiToken } from '@/lib/api-token'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

type CreateBookingResult = { success: true; bookingId: string } | { success: false; error: string }

interface CreateBookingInput {
  requestedVehicleId: string
  pickupLocationId: string
  dropoffLocationId: string
  insuranceOptionId?: string | null
  startAt: string
  endAt: string
  notes?: string
}

// Slice 6 (#392): renters book a CONCRETE vehicle chosen in the storefront.
// operatorId/classId/assignedVehicleId/pricing are all server-derived; the web
// only sends what the renter selected. renterId is forced to self at the API
// for non-staff, so we don't send it. A 409 means the car was taken between
// browse and submit (the DB exclusion constraint is the real guard).
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'You must be logged in to make a booking.' }
  }

  if (!input.requestedVehicleId || !input.pickupLocationId || !input.dropoffLocationId) {
    return { success: false, error: 'Vehicle and pickup location are required.' }
  }

  if (!input.startAt || !input.endAt) {
    return { success: false, error: 'Start and end dates are required.' }
  }

  if (new Date(input.endAt) <= new Date(input.startAt)) {
    return { success: false, error: 'End date must be after start date.' }
  }

  const token = await getApiToken()
  const client = createApiClient(token)
  const res = await client.bookings.$post({
    json: {
      requestedVehicleId: input.requestedVehicleId,
      pickupLocationId: input.pickupLocationId,
      dropoffLocationId: input.dropoffLocationId,
      ...(input.insuranceOptionId ? { insuranceOptionId: input.insuranceOptionId } : {}),
      startAt: input.startAt,
      endAt: input.endAt,
      source: 'DIRECT',
      idempotencyKey: crypto.randomUUID(),
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
      error: 'This car was just booked for these dates. Please choose another vehicle.',
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
  // Slice 6 (#392): the booking's vehicle column is assignedVehicleId.
  assignedVehicleId: string
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
    vehicleId: booking.assignedVehicleId,
    vehicleName: booking.vehicle?.name ?? '',
    vehiclePhoto: booking.vehicle?.photos?.[0] ?? null,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
    createdAt: booking.createdAt,
  }))
}

// Locked insurance choice at booking time (#392). Mirrors the API's
// InsuranceSnapshot; null when the renter declined or the operator had none.
export interface BookingInsuranceSnapshot {
  insuranceOptionId: string
  name: string
  dailyPriceJpy: number
  deductibleJpy: number | null
}

// One snapshotted fee disclosed at booking time (#392). vehicleClassId null =
// operator-wide; otherwise the fee is specific to the booking's class.
export interface BookingFeeSnapshotItem {
  feeType: string
  unit: string
  amountJpy: number
  vehicleClassId: string | null
}

interface Booking {
  id: string
  renterId: string
  classId: string | null
  requestedVehicleId: string
  assignedVehicleId: string
  pickupLocationId: string
  dropoffLocationId: string
  startAt: string
  endAt: string
  effectiveEndAt: string
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  source: string
  bookingCode: string
  insuranceOptionId: string | null
  insuranceSnapshot: BookingInsuranceSnapshot | null
  feeSnapshot: BookingFeeSnapshotItem[]
  totalPrice: number | null
  externalId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  // Renter-safe operator projection (#393, §4h). Attached by the API's findById;
  // the confirmation page reads preAuthHandoffUrl for the pre-auth CTA (null => hide).
  operator?: { name: string; preAuthHandoffUrl: string | null }
}

export async function getBookingById(id: string): Promise<Booking | null> {
  const token = await getApiToken()
  const client = createApiClient(token)
  const res = await client.bookings[':id'].$get({ param: { id } })
  const json = (await res.json()) as ApiResponse<Booking>

  if (!json.success) return null

  return json.data
}
