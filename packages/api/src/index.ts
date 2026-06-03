import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { getDb } from '@kuruma/shared/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { setupGlobalHandlers } from './error-handlers'
import { requireAuth } from './middleware/auth'
import { structuredLogger } from './middleware/logger'
import { requestId } from './middleware/request-id'
import { DisabledPhotoStorage } from './repositories/disabled-photo-storage'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleCustomerRepository,
  DrizzleFleetOverviewRepository,
  DrizzleMaintenanceLogRepository,
  DrizzleMessageRepository,
  DrizzleOperatorRepository,
  DrizzleStatsRepository,
  DrizzleThreadRepository,
  DrizzleUserRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleDetailRepository,
  DrizzleVehicleRepository,
  createDrizzleTransaction,
} from './repositories/drizzle'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryCustomerRepository,
  InMemoryFleetOverviewRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryMessageRepository,
  InMemoryOperatorRepository,
  InMemoryStatsRepository,
  InMemoryThreadRepository,
  InMemoryUserRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from './repositories/in-memory'
import { InMemoryVehicleDetailRepository } from './repositories/in-memory-vehicle-detail'
import { InMemoryPhotoStorage } from './repositories/in-memory/photo-storage'
import { type R2BucketLike, R2PhotoStorage } from './repositories/r2-photo-storage'
import type {
  AvailabilityRepository,
  BookingRepository,
  CustomerRepository,
  FleetOverviewRepository,
  MaintenanceLogRepository,
  MessageRepository,
  OperatorRepository,
  PhotoStorage,
  RunInTransaction,
  StatsRepository,
  ThreadRepository,
  UserRepository,
  VehicleClassRepository,
  VehicleDetailRepository,
  VehicleRepository,
} from './repositories/types'
import { createAdminRoutes } from './routes/admin'
import { createAvailabilityRoutes } from './routes/availability'
import { createBookingRoutes } from './routes/bookings'
import { createCustomerRoutes } from './routes/customers'
import { createFleetOverviewRoutes } from './routes/fleet-overview'
import health from './routes/health'
import { createMaintenanceLogRoutes } from './routes/maintenance-logs'
import { createMessageRoutes } from './routes/messages'
import { createStatsRoutes } from './routes/stats'
import { createTranslateRoutes } from './routes/translate'
import { createUserRoutes } from './routes/users'
import { createVehicleClassRoutes } from './routes/vehicle-classes'
import { createVehicleDetailRoutes } from './routes/vehicle-detail'
import { createVehiclePhotoRoutes } from './routes/vehicle-photos'
import { createVehicleRoutes } from './routes/vehicles'
import { BookingService } from './services/booking'
import { CustomerService } from './services/customer'
import { FleetOverviewService } from './services/fleet-overview'
import { GoogleTranslationProvider } from './services/google-translation-provider'
import { MaintenanceService } from './services/maintenance'
import { MessageTranslationService } from './services/message-translation'
import { OperatorService } from './services/operator'
import type { TranslationProvider } from './services/translation-provider'
import { VehicleClassService } from './services/vehicle-class'
import { VehicleClassAvailabilityService } from './services/vehicle-class-availability'
import { VehicleDetailService } from './services/vehicle-detail'
import { VehiclePhotoService } from './services/vehicle-photo'
import { type ResolveWriteOperatorId, resolveOperatorIdForWrite } from './tenancy'

export function createApp(overrides?: {
  vehicleRepo: VehicleRepository
  bookingRepo: BookingRepository
  availabilityRepo: AvailabilityRepository
  fleetOverviewRepo?: FleetOverviewRepository
  vehicleDetailRepo?: VehicleDetailRepository
  statsRepo?: StatsRepository
  threadRepo?: ThreadRepository
  messageRepo?: MessageRepository
  vehicleClassRepo?: VehicleClassRepository
  maintenanceLogRepo?: MaintenanceLogRepository
  photoStorage?: PhotoStorage
  userRepo?: UserRepository
  customerRepo?: CustomerRepository
  operatorRepo?: OperatorRepository
  photoUploadLimiter?: RateLimitBinding
  photoUploadUserLimiter?: RateLimitBinding
  publicCatalogLimiter?: RateLimitBinding
}) {
  let vehicleClassRepo: VehicleClassRepository
  let vehicleRepo: VehicleRepository
  let bookingRepo: BookingRepository
  let availabilityRepo: AvailabilityRepository
  let userRepo: UserRepository
  let fleetOverviewRepo: FleetOverviewRepository
  let vehicleDetailRepo: VehicleDetailRepository
  let statsRepo: StatsRepository
  let threadRepo: ThreadRepository
  let messageRepo: MessageRepository
  let maintenanceLogRepo: MaintenanceLogRepository
  let photoStorage: PhotoStorage
  let customerRepo: CustomerRepository
  let operatorRepo: OperatorRepository
  let runInTransaction: RunInTransaction
  const photoUploadLimiter =
    overrides?.photoUploadLimiter ??
    ((globalThis as Record<string, unknown>).PHOTO_UPLOAD_LIMITER as RateLimitBinding | undefined)
  const photoUploadUserLimiter =
    overrides?.photoUploadUserLimiter ??
    ((globalThis as Record<string, unknown>).PHOTO_UPLOAD_USER_LIMITER as
      | RateLimitBinding
      | undefined)
  const publicCatalogLimiter =
    overrides?.publicCatalogLimiter ??
    ((globalThis as Record<string, unknown>).PUBLIC_CATALOG_LIMITER as RateLimitBinding | undefined)

  if (overrides) {
    ;({ vehicleRepo, bookingRepo, availabilityRepo } = overrides)
    vehicleClassRepo = overrides.vehicleClassRepo ?? new InMemoryVehicleClassRepository()
    maintenanceLogRepo = overrides.maintenanceLogRepo ?? new InMemoryMaintenanceLogRepository()
    runInTransaction = async (fn) => fn({ vehicleRepo, maintenanceLogRepo })
    fleetOverviewRepo =
      overrides.fleetOverviewRepo ??
      new InMemoryFleetOverviewRepository(vehicleRepo, bookingRepo, new Map(), maintenanceLogRepo)
    vehicleDetailRepo =
      overrides.vehicleDetailRepo ??
      new InMemoryVehicleDetailRepository(vehicleRepo, bookingRepo, new Map(), maintenanceLogRepo)
    statsRepo = overrides.statsRepo ?? new InMemoryStatsRepository(vehicleRepo, bookingRepo)
    threadRepo = overrides.threadRepo ?? new InMemoryThreadRepository()
    messageRepo =
      overrides.messageRepo ?? new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
    photoStorage = overrides.photoStorage ?? new InMemoryPhotoStorage()
    userRepo = overrides.userRepo ?? new InMemoryUserRepository()
    customerRepo = overrides.customerRepo ?? new InMemoryCustomerRepository(new Map(), new Map())
    operatorRepo = overrides.operatorRepo ?? new InMemoryOperatorRepository()
  } else if (process.env.DATABASE_URL) {
    const db = getDb()
    vehicleClassRepo = new DrizzleVehicleClassRepository(db)
    vehicleRepo = new DrizzleVehicleRepository(db)
    bookingRepo = new DrizzleBookingRepository(db)
    availabilityRepo = new DrizzleAvailabilityRepository(db)
    maintenanceLogRepo = new DrizzleMaintenanceLogRepository(db)
    runInTransaction = createDrizzleTransaction(db)
    fleetOverviewRepo = new DrizzleFleetOverviewRepository(db)
    vehicleDetailRepo = new DrizzleVehicleDetailRepository(db)
    statsRepo = new DrizzleStatsRepository(db)
    threadRepo = new DrizzleThreadRepository(db)
    messageRepo = new DrizzleMessageRepository(db)
    userRepo = new DrizzleUserRepository(db)
    customerRepo = new DrizzleCustomerRepository(db)
    operatorRepo = new DrizzleOperatorRepository(db)
    const vehiclePhotosBucket = (globalThis as Record<string, unknown>).VEHICLE_PHOTOS as
      | R2BucketLike
      | undefined
    const photosPublicUrl = process.env.VEHICLE_PHOTOS_PUBLIC_URL ?? ''
    // In the Drizzle branch (production) an InMemory fallback is dangerous —
    // each CF Worker request gets a fresh instance, so uploads "succeed" but
    // return URLs pointing at nothing. DisabledPhotoStorage throws loudly.
    photoStorage =
      vehiclePhotosBucket && photosPublicUrl
        ? new R2PhotoStorage(vehiclePhotosBucket, photosPublicUrl)
        : new DisabledPhotoStorage()
  } else {
    vehicleClassRepo = new InMemoryVehicleClassRepository()
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo as InMemoryVehicleRepository,
      bookingRepo as InMemoryBookingRepository,
    )
    maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
    fleetOverviewRepo = new InMemoryFleetOverviewRepository(
      vehicleRepo,
      bookingRepo,
      new Map(),
      maintenanceLogRepo,
    )
    vehicleDetailRepo = new InMemoryVehicleDetailRepository(
      vehicleRepo,
      bookingRepo,
      new Map(),
      maintenanceLogRepo,
    )
    statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
    threadRepo = new InMemoryThreadRepository()
    messageRepo = new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
    maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
    runInTransaction = async (fn) => fn({ vehicleRepo, maintenanceLogRepo })
    userRepo = new InMemoryUserRepository()
    photoStorage = new InMemoryPhotoStorage()
    customerRepo = new InMemoryCustomerRepository(new Map(), new Map())
    operatorRepo = new InMemoryOperatorRepository()
  }

  // Translation provider: real Google when the key is set. In production
  // without a key, a sentinel provider throws on first use (not at boot,
  // so unrelated tests can still run createApp). The stub is dev-only
  // so a secret drift can't ship working translations silently.
  const translationProvider: TranslationProvider = (() => {
    const key = process.env.GOOGLE_TRANSLATE_API_KEY
    if (key) return new GoogleTranslationProvider(key)
    if (process.env.NODE_ENV === 'production') {
      return {
        translate: async () => {
          throw new Error('GOOGLE_TRANSLATE_API_KEY not configured')
        },
      }
    }
    return {
      translate: async (text, source, targetLanguage) => ({
        translatedText: `[${targetLanguage}] ${text}`,
        detectedLanguage: source ?? targetLanguage,
      }),
    }
  })()

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

  // Auth middleware on all protected paths.
  // vehicle-classes: public GETs for renter catalog (list, by-slug, availability)
  // are registered before auth inside createVehicleClassRoutes. Mutations +
  // admin-only GET-by-id stay auth-protected via inner middleware.
  app.use('/vehicles/*', requireAuth())
  app.use('/bookings/*', requireAuth())
  app.use('/availability/*', requireAuth())
  app.use('/threads/*', requireAuth())
  app.use('/customers/*', requireAuth())
  app.use('/customers', requireAuth())
  app.use('/users/*', requireAuth())
  app.use('/admin/*', requireAuth())

  const vehicleClassService = new VehicleClassService(vehicleClassRepo, vehicleRepo, bookingRepo)
  const vehicleClassAvailabilityService = new VehicleClassAvailabilityService(
    vehicleClassRepo,
    vehicleRepo,
    availabilityRepo,
  )
  // Messaging: if a staff user id is configured, every confirmed booking
  // auto-creates a renter/staff thread for coordination (design doc
  // `docs/plans/2026-04-14-messaging-design.md`).
  const staffUserId = process.env.DEFAULT_STAFF_ID
  const threading = staffUserId ? { threadRepo, staffUserId } : undefined
  const bookingService = new BookingService(
    bookingRepo,
    vehicleRepo,
    userRepo,
    vehicleClassRepo,
    threading,
  )
  const customerService = new CustomerService(customerRepo, userRepo)
  const maintenanceService = new MaintenanceService(
    vehicleRepo,
    maintenanceLogRepo,
    runInTransaction,
  )
  const fleetOverviewService = new FleetOverviewService(fleetOverviewRepo)
  const vehicleDetailService = new VehicleDetailService(vehicleDetailRepo)
  const operatorService = new OperatorService(operatorRepo)
  // #401: bind the write-operator resolver to the concrete operator lookup, so
  // the write routes resolve the target tenant without importing a repository.
  const resolveWriteOperatorId: ResolveWriteOperatorId = (ctx, inputOperatorId) =>
    resolveOperatorIdForWrite(ctx, inputOperatorId, operatorRepo)

  // Chain .route() calls so TypeScript infers the full route type tree.
  // hc<AppType> needs this to produce typed client methods.
  return app
    .route('/', health)
    .route('/', createFleetOverviewRoutes(fleetOverviewService))
    .route('/', createVehicleDetailRoutes(vehicleDetailService))
    .route(
      '/',
      createVehicleClassRoutes(
        vehicleClassService,
        vehicleClassAvailabilityService,
        resolveWriteOperatorId,
        publicCatalogLimiter,
      ),
    )
    .route('/', createVehicleRoutes(vehicleRepo, maintenanceService, resolveWriteOperatorId))
    .route(
      '/',
      createVehiclePhotoRoutes(
        new VehiclePhotoService(vehicleRepo, photoStorage),
        photoUploadLimiter,
        photoUploadUserLimiter,
      ),
    )
    .route('/', createMaintenanceLogRoutes(maintenanceService))
    .route('/', createBookingRoutes(bookingService))
    .route('/', createAvailabilityRoutes(availabilityRepo))
    .route('/', createStatsRoutes(statsRepo))
    .route('/', createMessageRoutes(threadRepo, messageRepo))
    .route(
      '/',
      createTranslateRoutes(new MessageTranslationService(messageRepo, translationProvider)),
    )
    .route('/', createCustomerRoutes(customerService))
    .route('/', createUserRoutes(userRepo, threadRepo))
    .route('/', createAdminRoutes(operatorService))
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

/**
 * Inferred type of the composed app; used by the web client for `hc<AppType>()`.
 * Declared here so consumers can `import type { AppType } from '@kuruma/api'`
 * without triggering any runtime side-effects.
 */
export type AppType = ReturnType<typeof createApp>
