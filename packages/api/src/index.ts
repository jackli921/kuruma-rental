import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { getDb } from '@kuruma/shared/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { setupGlobalHandlers } from './error-handlers'
import { requireAuth } from './middleware/auth'
import { structuredLogger } from './middleware/logger'
import { requestId } from './middleware/request-id'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleFleetOverviewRepository,
  DrizzleMessageRepository,
  DrizzleStatsRepository,
  DrizzleThreadRepository,
  DrizzleVehicleRepository,
} from './repositories/drizzle'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryFleetOverviewRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryMessageRepository,
  InMemoryStatsRepository,
  InMemoryThreadRepository,
  InMemoryVehicleRepository,
} from './repositories/in-memory'
import { InMemoryVehicleDetailRepository } from './repositories/in-memory-vehicle-detail'
import type {
  AvailabilityRepository,
  BookingRepository,
  FleetOverviewRepository,
  MaintenanceLogRepository,
  MessageRepository,
  StatsRepository,
  ThreadRepository,
  VehicleDetailRepository,
  VehicleRepository,
} from './repositories/types'
import { createAvailabilityRoutes } from './routes/availability'
import { createBookingRoutes } from './routes/bookings'
import { createFleetOverviewRoutes } from './routes/fleet-overview'
import health from './routes/health'
import { createMaintenanceLogRoutes } from './routes/maintenance-logs'
import { createMessageRoutes } from './routes/messages'
import { createStatsRoutes } from './routes/stats'
import { createVehicleDetailRoutes } from './routes/vehicle-detail'
import { createVehicleRoutes } from './routes/vehicles'
import { BookingService } from './services/booking'
import { MaintenanceService } from './services/maintenance'

export function createApp(overrides?: {
  vehicleRepo: VehicleRepository
  bookingRepo: BookingRepository
  availabilityRepo: AvailabilityRepository
  fleetOverviewRepo?: FleetOverviewRepository
  vehicleDetailRepo?: VehicleDetailRepository
  statsRepo?: StatsRepository
  threadRepo?: ThreadRepository
  messageRepo?: MessageRepository
  maintenanceLogRepo?: MaintenanceLogRepository
}) {
  let vehicleRepo: VehicleRepository
  let bookingRepo: BookingRepository
  let availabilityRepo: AvailabilityRepository
  let fleetOverviewRepo: FleetOverviewRepository
  let vehicleDetailRepo: VehicleDetailRepository
  let statsRepo: StatsRepository
  let threadRepo: ThreadRepository
  let messageRepo: MessageRepository
  let maintenanceLogRepo: MaintenanceLogRepository

  if (overrides) {
    ;({ vehicleRepo, bookingRepo, availabilityRepo } = overrides)
    maintenanceLogRepo = overrides.maintenanceLogRepo ?? new InMemoryMaintenanceLogRepository()
    fleetOverviewRepo =
      overrides.fleetOverviewRepo ?? new InMemoryFleetOverviewRepository(vehicleRepo, bookingRepo)
    vehicleDetailRepo =
      overrides.vehicleDetailRepo ?? new InMemoryVehicleDetailRepository(vehicleRepo, bookingRepo)
    statsRepo = overrides.statsRepo ?? new InMemoryStatsRepository(vehicleRepo, bookingRepo)
    threadRepo = overrides.threadRepo ?? new InMemoryThreadRepository()
    messageRepo =
      overrides.messageRepo ?? new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
  } else if (process.env.DATABASE_URL) {
    const db = getDb()
    vehicleRepo = new DrizzleVehicleRepository(db)
    bookingRepo = new DrizzleBookingRepository(db)
    availabilityRepo = new DrizzleAvailabilityRepository(db)
    fleetOverviewRepo = new DrizzleFleetOverviewRepository(db)
    vehicleDetailRepo = new InMemoryVehicleDetailRepository(vehicleRepo, bookingRepo)
    statsRepo = new DrizzleStatsRepository(db)
    threadRepo = new DrizzleThreadRepository(db)
    messageRepo = new DrizzleMessageRepository(db)
    maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
  } else {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo as InMemoryVehicleRepository,
      bookingRepo as InMemoryBookingRepository,
    )
    fleetOverviewRepo = new InMemoryFleetOverviewRepository(vehicleRepo, bookingRepo)
    vehicleDetailRepo = new InMemoryVehicleDetailRepository(vehicleRepo, bookingRepo)
    statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
    threadRepo = new InMemoryThreadRepository()
    messageRepo = new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
    maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
  }

  const app = new Hono()

  // Global error handlers — prevent stack traces leaking to clients.
  setupGlobalHandlers(app)

  // Request ID + structured logging — must be before all other middleware
  // so every request gets a correlation ID and timing.
  app.use('*', requestId())
  app.use('*', structuredLogger())

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

  // Rate limiting via Cloudflare's native rate limit binding. Atomic counters
  // with sub-ms latency, no KV race conditions. Gracefully skipped in local
  // dev (binding absent → key returns "" → bypass).
  const rateLimiter = (globalThis as Record<string, unknown>).RATE_LIMITER as
    | RateLimitBinding
    | undefined
  if (rateLimiter) {
    app.use('*', (c, next) =>
      rateLimit(rateLimiter, (c) => c.req.header('cf-connecting-ip') ?? '')(c, next),
    )
  }

  // Auth middleware on all protected paths
  app.use('/vehicles/*', requireAuth())
  app.use('/bookings/*', requireAuth())
  app.use('/availability/*', requireAuth())
  app.use('/threads/*', requireAuth())

  const bookingService = new BookingService(bookingRepo, vehicleRepo)
  const maintenanceService = new MaintenanceService(vehicleRepo, maintenanceLogRepo)

  // Chain .route() calls so TypeScript infers the full route type tree.
  // hc<AppType> needs this to produce typed client methods.
  return app
    .route('/', health)
    .route('/', createFleetOverviewRoutes(fleetOverviewRepo))
    .route('/', createVehicleDetailRoutes(vehicleDetailRepo))
    .route('/', createVehicleRoutes(vehicleRepo, maintenanceService))
    .route('/', createMaintenanceLogRoutes(maintenanceService))
    .route('/', createBookingRoutes(bookingService))
    .route('/', createAvailabilityRoutes(availabilityRepo))
    .route('/', createStatsRoutes(statsRepo))
    .route('/', createMessageRoutes(threadRepo, messageRepo))
}

const DEV_WEB_ORIGINS = ['http://localhost:3001', 'http://127.0.0.1:3001']

function resolveAllowedOrigins(envValue: string | undefined): string[] {
  const fromEnv = (envValue ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // Only include dev origins outside production so `bun run dev` works
  // out of the box without leaking localhost to prod.
  const devOrigins = process.env.NODE_ENV === 'production' ? [] : DEV_WEB_ORIGINS
  return [...new Set([...devOrigins, ...fromEnv])]
}

export default createApp()
