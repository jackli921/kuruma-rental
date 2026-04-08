import { integer, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'

export const roleEnum = pgEnum('role', ['RENTER', 'STAFF', 'ADMIN'])

// Auth.js required fields + app profile fields
// Column names must be camelCase to match @auth/drizzle-adapter expectations
export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique().notNull(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  role: roleEnum('role').notNull().default('RENTER'),
  language: text('language').notNull().default('en'),
  country: text('country'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
)

export const transmissionEnum = pgEnum('transmission', ['AUTO', 'MANUAL'])
export const vehicleStatusEnum = pgEnum('vehicle_status', ['AVAILABLE', 'MAINTENANCE', 'RETIRED'])
export const bookingStatusEnum = pgEnum('booking_status', [
  'CONFIRMED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
])
export const bookingSourceEnum = pgEnum('booking_source', ['DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER'])

export const vehicles = pgTable('vehicles', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  seats: integer('seats').notNull(),
  transmission: transmissionEnum('transmission').notNull(),
  fuelType: text('fuelType'),
  status: vehicleStatusEnum('status').notNull().default('AVAILABLE'),
  bufferMinutes: integer('bufferMinutes').notNull().default(60),
  minRentalHours: integer('minRentalHours'),
  maxRentalHours: integer('maxRentalHours'),
  advanceBookingHours: integer('advanceBookingHours'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const bookings = pgTable('bookings', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  renterId: text('renterId')
    .notNull()
    .references(() => users.id),
  vehicleId: text('vehicleId')
    .notNull()
    .references(() => vehicles.id),
  startAt: timestamp('startAt', { withTimezone: true, mode: 'date' }).notNull(),
  endAt: timestamp('endAt', { withTimezone: true, mode: 'date' }).notNull(),
  status: bookingStatusEnum('status').notNull().default('CONFIRMED'),
  source: bookingSourceEnum('source').notNull().default('DIRECT'),
  externalId: text('externalId'),
  notes: text('notes'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const VALID_BOOKING_TRANSITIONS: Record<string, string[]> = {
  CONFIRMED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}
