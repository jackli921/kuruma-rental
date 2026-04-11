import { getDb } from '@kuruma/shared/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleMessageRepository,
  DrizzleStatsRepository,
  DrizzleThreadRepository,
  DrizzleVehicleRepository,
} from './repositories/drizzle'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryMessageRepository,
  InMemoryStatsRepository,
  InMemoryThreadRepository,
  InMemoryVehicleRepository,
} from './repositories/in-memory'
import type {
  AvailabilityRepository,
  BookingRepository,
  MessageRepository,
  StatsRepository,
  ThreadRepository,
  VehicleRepository,
} from './repositories/types'
import { createAvailabilityRoutes } from './routes/availability'
import { createBookingRoutes } from './routes/bookings'
import health from './routes/health'
import { createMessageRoutes } from './routes/messages'
import { createStatsRoutes } from './routes/stats'
import { createVehicleRoutes } from './routes/vehicles'

export function createApp(overrides?: {
  vehicleRepo: VehicleRepository
  bookingRepo: BookingRepository
  availabilityRepo: AvailabilityRepository
  statsRepo?: StatsRepository
  threadRepo?: ThreadRepository
  messageRepo?: MessageRepository
}) {
  let vehicleRepo: VehicleRepository
  let bookingRepo: BookingRepository
  let availabilityRepo: AvailabilityRepository
  let statsRepo: StatsRepository
  let threadRepo: ThreadRepository
  let messageRepo: MessageRepository

  if (overrides) {
    ;({ vehicleRepo, bookingRepo, availabilityRepo } = overrides)
    statsRepo = overrides.statsRepo ?? new InMemoryStatsRepository(vehicleRepo, bookingRepo)
    threadRepo = overrides.threadRepo ?? new InMemoryThreadRepository()
    messageRepo =
      overrides.messageRepo ?? new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
  } else if (process.env.DATABASE_URL) {
    const db = getDb()
    vehicleRepo = new DrizzleVehicleRepository(db)
    bookingRepo = new DrizzleBookingRepository(db)
    availabilityRepo = new DrizzleAvailabilityRepository(db)
    statsRepo = new DrizzleStatsRepository(db)
    threadRepo = new DrizzleThreadRepository(db)
    messageRepo = new DrizzleMessageRepository(db)
  } else {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo as InMemoryVehicleRepository,
      bookingRepo as InMemoryBookingRepository,
    )
    statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
    threadRepo = new InMemoryThreadRepository()
    messageRepo = new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
  }

  const app = new Hono()

  // CORS. Browser calls from the web package (localhost:3001 in dev, the
  // deployed origin in prod) are same-intent but cross-origin, so without
  // this middleware every fetch rejects and the UI hangs on loading states.
  // Origins come from WEB_ORIGIN (comma-separated) so staging and prod can
  // diverge from dev without code changes; the dev defaults cover the
  // common local setup. 3rd-party API callers (Trip.com) hit the Worker
  // server-to-server and do not need CORS.
  const allowedOrigins = resolveAllowedOrigins(process.env.WEB_ORIGIN)
  app.use(
    '*',
    cors({
      origin: allowedOrigins,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  )

  app.route('/', health)
  app.route('/', createVehicleRoutes(vehicleRepo))
  app.route('/', createBookingRoutes(bookingRepo, vehicleRepo))
  app.route('/', createAvailabilityRoutes(availabilityRepo))
  app.route('/', createStatsRoutes(statsRepo))
  app.route('/', createMessageRoutes(threadRepo, messageRepo))

  return app
}

const DEV_WEB_ORIGINS = ['http://localhost:3001', 'http://127.0.0.1:3001']

function resolveAllowedOrigins(envValue: string | undefined): string[] {
  const fromEnv = (envValue ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // Always include the dev origins so `bun run dev` + `bun run dev:api`
  // works out of the box. Deduped because the user may also list them in
  // WEB_ORIGIN explicitly.
  return [...new Set([...DEV_WEB_ORIGINS, ...fromEnv])]
}

export default createApp()
