'use server'

import { auth } from '@/auth'
import { getDb } from '@kuruma/shared/db'
import { bookings } from '@kuruma/shared/db/schema'
import { and, eq, gt, lt } from 'drizzle-orm'

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
    .select()
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

export async function getBookingById(id: string) {
  const db = getDb()
  const rows = await db.select().from(bookings).where(eq(bookings.id, id))
  const booking = rows[0]
  return booking ?? null
}
