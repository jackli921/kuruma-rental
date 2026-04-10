'use server'

import { auth } from '@/auth'
import { getDb } from '@kuruma/shared/db'
import { bookings, vehicles } from '@kuruma/shared/db/schema'
import { and, desc, eq, gt, lt } from 'drizzle-orm'

interface CreateBookingInput {
  vehicleId: string
  startAt: string
  endAt: string
  notes?: string
}

type CreateBookingResult = { success: true; bookingId: string } | { success: false; error: string }

export async function checkAvailability(
  vehicleId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const db = getDb()
  const conflicts = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.vehicleId, vehicleId),
        lt(bookings.startAt, endAt),
        gt(bookings.endAt, startAt),
      ),
    )

  return conflicts.length === 0
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

  const db = getDb()
  const rows = await db
    .insert(bookings)
    .values({
      renterId: session.user.id,
      vehicleId: input.vehicleId,
      startAt,
      endAt,
      status: 'CONFIRMED',
      source: 'DIRECT',
    })
    .returning()

  const booking = rows[0]
  if (!booking) {
    return { success: false, error: 'Failed to create booking.' }
  }

  return { success: true, bookingId: booking.id }
}

export type BookingWithVehicle = {
  id: string
  vehicleId: string
  vehicleName: string
  vehiclePhoto: string | null
  startAt: Date
  endAt: Date
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  createdAt: Date
}

export async function getBookingsByRenterId(userId: string): Promise<BookingWithVehicle[]> {
  const db = getDb()
  const rows = await db
    .select({
      bookings: {
        id: bookings.id,
        vehicleId: bookings.vehicleId,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
        createdAt: bookings.createdAt,
      },
      vehicles: {
        name: vehicles.name,
        photos: vehicles.photos,
      },
    })
    .from(bookings)
    .innerJoin(vehicles, eq(bookings.vehicleId, vehicles.id))
    .where(eq(bookings.renterId, userId))
    .orderBy(desc(bookings.startAt))

  return rows.map((row) => ({
    id: row.bookings.id,
    vehicleId: row.bookings.vehicleId,
    vehicleName: row.vehicles.name,
    vehiclePhoto: row.vehicles.photos[0] ?? null,
    startAt: row.bookings.startAt,
    endAt: row.bookings.endAt,
    status: row.bookings.status,
    createdAt: row.bookings.createdAt,
  }))
}

export async function getBookingById(id: string) {
  const db = getDb()
  const rows = await db
    .select({
      id: bookings.id,
      renterId: bookings.renterId,
      vehicleId: bookings.vehicleId,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      status: bookings.status,
      source: bookings.source,
      externalId: bookings.externalId,
      notes: bookings.notes,
      createdAt: bookings.createdAt,
      updatedAt: bookings.updatedAt,
    })
    .from(bookings)
    .where(eq(bookings.id, id))
  const booking = rows[0]
  return booking ?? null
}
