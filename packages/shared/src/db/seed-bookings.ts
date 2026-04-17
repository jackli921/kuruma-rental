import { eq, sql } from 'drizzle-orm'
import { getDb } from './index'
import { bookings, users, vehicles } from './schema'

// Demo renters — emails clearly marked @example.test so they never collide
// with real OAuth users, and so you can grep them out for cleanup later.
const DEMO_RENTERS = [
  { name: 'Tanaka Yui', email: 'yui@example.test', language: 'ja' },
  { name: 'Chen Wei', email: 'wei@example.test', language: 'zh' },
  { name: 'Sarah Smith', email: 'sarah@example.test', language: 'en' },
  { name: 'Sato Hiroshi', email: 'hiroshi@example.test', language: 'ja' },
] as const

// Given a start date, returns a Date `hours` later.
function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 60 * 60 * 1000)
}

// Returns a date at hour:00 (minutes/sec/ms zeroed) for today + dayOffset.
function dayAt(dayOffset: number, hour: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d
}

async function seed() {
  const db = getDb()

  console.log('Clearing demo bookings and demo renters...')
  // Delete bookings by demo renter (cascades are safe — bookings reference users)
  await db
    .delete(bookings)
    .where(sql`${bookings.renterId} IN (SELECT id FROM ${users} WHERE email LIKE '%@example.test')`)
  await db.delete(users).where(sql`${users.email} LIKE '%@example.test'`)

  console.log('Creating demo renters...')
  const insertedRenters = await db
    .insert(users)
    .values(
      DEMO_RENTERS.map((r) => ({
        name: r.name,
        email: r.email,
        language: r.language,
        role: 'RENTER' as const,
      })),
    )
    .returning({ id: users.id, name: users.name })

  console.log('Fetching vehicles...')
  const vehicleRows = await db
    .select({ id: vehicles.id, name: vehicles.name })
    .from(vehicles)
    .where(eq(vehicles.status, 'AVAILABLE'))
    .limit(10)

  if (vehicleRows.length === 0) {
    console.error('No vehicles found. Run `bun run db:seed` first.')
    process.exit(1)
  }

  const renter = (i: number) => {
    const r = insertedRenters[i % insertedRenters.length]
    if (!r) throw new Error('No demo renters created')
    return r.id
  }
  const vehicle = (i: number) => {
    const v = vehicleRows[i % vehicleRows.length]
    if (!v) throw new Error('No vehicles available')
    return v.id
  }

  // Spread bookings across the current week + next week so the calendar
  // shows events immediately regardless of which day the user opens it.
  const bookingSeeds = [
    // Past — COMPLETED
    { dayOffset: -3, hour: 10, durationHours: 8, status: 'COMPLETED' as const, price: 8000 },
    { dayOffset: -5, hour: 9, durationHours: 24, status: 'COMPLETED' as const, price: 9500 },
    // Yesterday — CANCELLED
    { dayOffset: -1, hour: 14, durationHours: 4, status: 'CANCELLED' as const, price: null },
    // Today — ACTIVE (in progress)
    { dayOffset: 0, hour: 9, durationHours: 10, status: 'ACTIVE' as const, price: 12500 },
    { dayOffset: 0, hour: 14, durationHours: 6, status: 'ACTIVE' as const, price: 6500 },
    // Today/tomorrow — CONFIRMED (future)
    { dayOffset: 1, hour: 10, durationHours: 4, status: 'CONFIRMED' as const, price: 6500 },
    { dayOffset: 1, hour: 13, durationHours: 24, status: 'CONFIRMED' as const, price: 8000 },
    { dayOffset: 2, hour: 9, durationHours: 8, status: 'CONFIRMED' as const, price: 11500 },
    { dayOffset: 3, hour: 11, durationHours: 48, status: 'CONFIRMED' as const, price: 18000 },
    { dayOffset: 5, hour: 8, durationHours: 12, status: 'CONFIRMED' as const, price: 9500 },
    { dayOffset: 7, hour: 10, durationHours: 6, status: 'CONFIRMED' as const, price: 6500 },
    { dayOffset: 10, hour: 14, durationHours: 72, status: 'CONFIRMED' as const, price: 24000 },
  ]

  console.log('Creating demo bookings...')
  const inserted = await db
    .insert(bookings)
    .values(
      bookingSeeds.map((b, i) => {
        const startAt = dayAt(b.dayOffset, b.hour)
        const endAt = addHours(startAt, b.durationHours)
        return {
          renterId: renter(i),
          vehicleId: vehicle(i),
          startAt,
          endAt,
          effectiveEndAt: endAt,
          status: b.status,
          source: 'DIRECT' as const,
          totalPrice: b.price,
          cancelledAt: b.status === 'CANCELLED' ? addHours(startAt, -24) : null,
          cancellationFee: b.status === 'CANCELLED' ? 0 : null,
        }
      }),
    )
    .returning({ id: bookings.id, status: bookings.status })

  console.log(`\nSeeded ${insertedRenters.length} demo renters.`)
  console.log(`Seeded ${inserted.length} demo bookings.`)
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed bookings failed:', err)
  process.exit(1)
})
