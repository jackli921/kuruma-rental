import * as schema from '@kuruma/shared/db/schema'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { createApp } from '../../packages/api/src/index'
import {
  type Db,
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleCustomerRepository,
  DrizzleFeeScheduleRepository,
  DrizzleFleetOverviewRepository,
  DrizzleInsuranceOptionRepository,
  DrizzleLocationRepository,
  DrizzleMaintenanceLogRepository,
  DrizzleMessageRepository,
  DrizzleNotificationLogRepository,
  DrizzleOperatorRepository,
  DrizzleStatsRepository,
  DrizzleStorefrontRepository,
  DrizzleThreadRepository,
  DrizzleUserRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleDetailRepository,
  DrizzleVehicleRepository,
} from '../../packages/api/src/repositories/drizzle'

// Driver note: production's getDb() uses @neondatabase/serverless (HTTP), whose
// drizzle adapter THROWS on db.transaction() ("No transactions support in
// neon-http driver"). The renter booking submit + slice-7 thread/notification
// dispatch open interactive transactions, so a plain createApp() (repos off
// getDb()) 500s on POST /bookings. The integration suite hits the same wall and
// resolves it identically: a postgres-js client (real Postgres TCP, transaction-
// capable) injected via createApp overrides. We mirror that so the E2E exercises
// the real service/repo logic + real data over real HTTP. (Production's neon-http
// interactive-transaction gap is a separate latent infra defect this milestone
// surfaced — a follow-up, not patched here; slice 8 must not touch slices 1-7.)
const port = Number(process.env.REAL_API_PORT ?? 8788)

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required for the real-DB e2e API server')

// Build from URL parts so libpq-only params (channel_binding) never reach
// postgres-js; prepare:false keeps interactive transactions safe over the Neon
// transaction-mode pooler. Mirrors e2e/real-db/pg.ts.
const u = new URL(url)
const client = postgres({
  host: u.hostname,
  port: u.port ? Number(u.port) : 5432,
  database: u.pathname.replace(/^\//, ''),
  username: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  ssl: 'require',
  prepare: false,
  max: 5,
})
const db = drizzle(client, { schema }) as unknown as Db

// Full Drizzle repo wiring (the production composition root, but off postgres-js).
// createApp's override branch swaps runInTransaction for an in-memory passthrough,
// so the booking submit's atomic wrap is relaxed (booking_events land in memory) —
// fine for this journey, which asserts the booking, confirmation, and the slice-7
// operator notification, none of which read the event log.
const app = createApp({
  vehicleRepo: new DrizzleVehicleRepository(db),
  bookingRepo: new DrizzleBookingRepository(db),
  availabilityRepo: new DrizzleAvailabilityRepository(db),
  vehicleClassRepo: new DrizzleVehicleClassRepository(db),
  fleetOverviewRepo: new DrizzleFleetOverviewRepository(db),
  vehicleDetailRepo: new DrizzleVehicleDetailRepository(db),
  statsRepo: new DrizzleStatsRepository(db),
  threadRepo: new DrizzleThreadRepository(db),
  messageRepo: new DrizzleMessageRepository(db),
  maintenanceLogRepo: new DrizzleMaintenanceLogRepository(db),
  userRepo: new DrizzleUserRepository(db),
  customerRepo: new DrizzleCustomerRepository(db),
  operatorRepo: new DrizzleOperatorRepository(db),
  locationRepo: new DrizzleLocationRepository(db),
  insuranceOptionRepo: new DrizzleInsuranceOptionRepository(db),
  feeScheduleRepo: new DrizzleFeeScheduleRepository(db),
  notificationLogRepo: new DrizzleNotificationLogRepository(db),
  storefrontRepo: new DrizzleStorefrontRepository(db),
})

Bun.serve({ port, fetch: app.fetch })
console.log(`[e2e] real API listening on http://localhost:${port}`)
