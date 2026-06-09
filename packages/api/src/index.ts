import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import { getDb, runTx } from '@kuruma/shared/db'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { DrizzleOAuthAccountStore } from './auth/drizzle-oauth-account-store'
import { FetchGoogleOAuthProvider } from './auth/fetch-google-oauth-provider'
import type { GoogleAuthRuntime, GoogleOAuthConfig } from './auth/google'
import { setupGlobalHandlers } from './error-handlers'
import { parseBoolFlag } from './lib/parse-bool-flag'
import { requireAuth } from './middleware/auth'
import { csrf } from './middleware/csrf'
import { structuredLogger } from './middleware/logger'
import { requestId } from './middleware/request-id'
import { DisabledDocumentStorage } from './repositories/disabled-document-storage'
import { DisabledPhotoStorage } from './repositories/disabled-photo-storage'
import {
  DrizzleAddOnRepository,
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
  DrizzlePaymentEventRepository,
  DrizzleRenterDocumentRepository,
  DrizzleStatsRepository,
  DrizzleStorefrontRepository,
  DrizzleThreadRepository,
  DrizzleUserRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleDetailRepository,
  DrizzleVehicleRepository,
  createDrizzleTransaction,
} from './repositories/drizzle'
import {
  InMemoryAddOnRepository,
  InMemoryAvailabilityRepository,
  InMemoryBookingEventRepository,
  InMemoryBookingRepository,
  InMemoryCustomerRepository,
  InMemoryDocumentStorage,
  InMemoryFeeScheduleRepository,
  InMemoryFleetOverviewRepository,
  InMemoryInsuranceOptionRepository,
  InMemoryLocationRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryMessageRepository,
  InMemoryNotificationLogRepository,
  InMemoryOperatorRepository,
  InMemoryPaymentEventRepository,
  InMemoryRenterDocumentRepository,
  InMemoryStatsRepository,
  InMemoryStorefrontRepository,
  InMemoryThreadRepository,
  InMemoryUserRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from './repositories/in-memory'
import { InMemoryVehicleDetailRepository } from './repositories/in-memory-vehicle-detail'
import { InMemoryPhotoStorage } from './repositories/in-memory/photo-storage'
import { R2DocumentStorage } from './repositories/r2-document-storage'
import { type R2BucketLike, R2PhotoStorage } from './repositories/r2-photo-storage'
import type {
  AddOnRepository,
  AvailabilityRepository,
  BookingRepository,
  CustomerRepository,
  DocumentStorage,
  FeeScheduleRepository,
  FleetOverviewRepository,
  InsuranceOptionRepository,
  LocationRepository,
  MaintenanceLogRepository,
  MessageRepository,
  NotificationLogRepository,
  OperatorRepository,
  PaymentEventRepository,
  PhotoStorage,
  RenterDocumentRepository,
  RunInTransaction,
  StatsRepository,
  StorefrontRepository,
  ThreadRepository,
  UserRepository,
  VehicleClassRepository,
  VehicleDetailRepository,
  VehicleRepository,
} from './repositories/types'
import { createAddOnRoutes } from './routes/add-ons'
import { createAdminRoutes } from './routes/admin'
import { createAuthRoutes } from './routes/auth'
import { createAvailabilityRoutes } from './routes/availability'
import { createBookingRoutes } from './routes/bookings'
import { createCustomerRoutes } from './routes/customers'
import { createDocumentRoutes } from './routes/documents'
import { createFeeScheduleRoutes } from './routes/fee-schedules'
import { createFleetOverviewRoutes } from './routes/fleet-overview'
import health from './routes/health'
import { createInsuranceOptionRoutes } from './routes/insurance-options'
import { createLocationRoutes } from './routes/locations'
import { createMaintenanceLogRoutes } from './routes/maintenance-logs'
import { createMessageRoutes } from './routes/messages'
import { createNotificationRoutes } from './routes/notifications'
import { createOperatorRoutes } from './routes/operators'
import { createPaymentRoutes } from './routes/payments'
import { createStatsRoutes } from './routes/stats'
import { createStorefrontRoutes } from './routes/storefronts'
import { createTranslateRoutes } from './routes/translate'
import { createUserRoutes } from './routes/users'
import { createVehicleClassRoutes } from './routes/vehicle-classes'
import { createVehicleDetailRoutes } from './routes/vehicle-detail'
import { createVehiclePhotoRoutes } from './routes/vehicle-photos'
import { createVehicleRoutes } from './routes/vehicles'
import { AddOnService } from './services/add-on'
import { BookingService } from './services/booking'
import { BookingPostCommitDispatcher } from './services/booking-post-commit-dispatcher'
import { CustomerService } from './services/customer'
import { documentVerificationGate } from './services/document-verification-gate'
import type { EmailSender } from './services/email/email-sender'
import { ResendEmailSender } from './services/email/resend-email-sender'
import { makeEnsureThread } from './services/ensure-thread'
import { FeeScheduleService } from './services/fee-schedule'
import { FleetOverviewService } from './services/fleet-overview'
import { GoogleTranslationProvider } from './services/google-translation-provider'
import { InsuranceOptionService } from './services/insurance-option'
import { LocationService } from './services/location'
import { MaintenanceService } from './services/maintenance'
import { MessageTranslationService } from './services/message-translation'
import { NotificationService } from './services/notification'
import { NotificationDispatcher } from './services/notification-dispatcher'
import { OperatorService } from './services/operator'
import { PaymentService } from './services/payment/payment'
import type { PaymentGateway } from './services/payment/payment-gateway'
import { StripePaymentGateway } from './services/payment/stripe-payment-gateway'
import { RenterDocumentService } from './services/renter-document'
import { StorefrontDetailService } from './services/storefront-detail'
import { StorefrontSearchService } from './services/storefront-search'
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
  renterDocumentRepo?: RenterDocumentRepository
  documentStorage?: DocumentStorage
  userRepo?: UserRepository
  customerRepo?: CustomerRepository
  operatorRepo?: OperatorRepository
  locationRepo?: LocationRepository
  insuranceOptionRepo?: InsuranceOptionRepository
  addOnRepo?: AddOnRepository
  feeScheduleRepo?: FeeScheduleRepository
  notificationLogRepo?: NotificationLogRepository
  storefrontRepo?: StorefrontRepository
  paymentEventRepo?: PaymentEventRepository
  // Inject a fake gateway in tests; absent ⇒ the env-resolved Stripe/sentinel.
  paymentGateway?: PaymentGateway
  photoUploadLimiter?: RateLimitBinding
  photoUploadUserLimiter?: RateLimitBinding
  publicCatalogLimiter?: RateLimitBinding
  // Injected Google OAuth runtime (provider + account store). Integration tests
  // pass a fake so the callback can be exercised without a live Google/DB.
  googleAuthRuntime?: GoogleAuthRuntime
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
  let renterDocumentRepo: RenterDocumentRepository
  let documentStorage: DocumentStorage
  let customerRepo: CustomerRepository
  let operatorRepo: OperatorRepository
  let locationRepo: LocationRepository
  let insuranceOptionRepo: InsuranceOptionRepository
  let addOnRepo: AddOnRepository
  let feeScheduleRepo: FeeScheduleRepository
  let notificationLogRepo: NotificationLogRepository
  let storefrontRepo: StorefrontRepository
  let paymentEventRepo: PaymentEventRepository
  let runInTransaction: RunInTransaction
  // Undefined unless an override injects one (tests) or the DB branch builds the
  // real one. Absent ⇒ /auth/google/callback 503s (e.g. local dev without a DB).
  let googleAuthRuntime: GoogleAuthRuntime | undefined
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
    const bookingEventRepo = new InMemoryBookingEventRepository()
    runInTransaction = async (fn) =>
      fn({
        vehicleRepo,
        maintenanceLogRepo,
        bookingRepo,
        bookingEventRepo,
        locationRepo,
        insuranceOptionRepo,
        addOnRepo,
        feeScheduleRepo,
      })
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
    renterDocumentRepo = overrides.renterDocumentRepo ?? new InMemoryRenterDocumentRepository()
    documentStorage = overrides.documentStorage ?? new InMemoryDocumentStorage()
    userRepo = overrides.userRepo ?? new InMemoryUserRepository()
    customerRepo = overrides.customerRepo ?? new InMemoryCustomerRepository(new Map(), new Map())
    operatorRepo = overrides.operatorRepo ?? new InMemoryOperatorRepository()
    locationRepo = overrides.locationRepo ?? new InMemoryLocationRepository()
    insuranceOptionRepo = overrides.insuranceOptionRepo ?? new InMemoryInsuranceOptionRepository()
    addOnRepo = overrides.addOnRepo ?? new InMemoryAddOnRepository()
    feeScheduleRepo = overrides.feeScheduleRepo ?? new InMemoryFeeScheduleRepository()
    notificationLogRepo = overrides.notificationLogRepo ?? new InMemoryNotificationLogRepository()
    storefrontRepo =
      overrides.storefrontRepo ?? new InMemoryStorefrontRepository(locationRepo, operatorRepo)
    paymentEventRepo = overrides.paymentEventRepo ?? new InMemoryPaymentEventRepository()
    googleAuthRuntime = overrides.googleAuthRuntime
  } else if (process.env.DATABASE_URL) {
    const db = getDb()
    vehicleClassRepo = new DrizzleVehicleClassRepository(db)
    vehicleRepo = new DrizzleVehicleRepository(db)
    bookingRepo = new DrizzleBookingRepository(db)
    availabilityRepo = new DrizzleAvailabilityRepository(db)
    maintenanceLogRepo = new DrizzleMaintenanceLogRepository(db)
    runInTransaction = createDrizzleTransaction(runTx)
    fleetOverviewRepo = new DrizzleFleetOverviewRepository(db)
    vehicleDetailRepo = new DrizzleVehicleDetailRepository(db)
    statsRepo = new DrizzleStatsRepository(db)
    threadRepo = new DrizzleThreadRepository(db, runTx)
    messageRepo = new DrizzleMessageRepository(db, runTx)
    userRepo = new DrizzleUserRepository(db)
    customerRepo = new DrizzleCustomerRepository(db)
    operatorRepo = new DrizzleOperatorRepository(db)
    locationRepo = new DrizzleLocationRepository(db)
    insuranceOptionRepo = new DrizzleInsuranceOptionRepository(db)
    addOnRepo = new DrizzleAddOnRepository(db)
    feeScheduleRepo = new DrizzleFeeScheduleRepository(db)
    notificationLogRepo = new DrizzleNotificationLogRepository(db)
    storefrontRepo = new DrizzleStorefrontRepository(db)
    paymentEventRepo = new DrizzlePaymentEventRepository(db)
    // Real Google OAuth runtime: HTTP provider + Drizzle-backed account store.
    // Built only here (the composition root) so the route stays adapter-agnostic.
    googleAuthRuntime = {
      provider: new FetchGoogleOAuthProvider(),
      accountStore: new DrizzleOAuthAccountStore(db),
    }
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
    // Renter documents live in a PRIVATE R2 bucket (no public URL). Absent the
    // binding (local dev / pre-#304), DisabledDocumentStorage throws loudly so
    // metadata never points at bytes that were never stored.
    const renterDocumentsBucket = (globalThis as Record<string, unknown>).RENTER_DOCUMENTS as
      | R2BucketLike
      | undefined
    documentStorage = renterDocumentsBucket
      ? new R2DocumentStorage(renterDocumentsBucket)
      : new DisabledDocumentStorage()
    renterDocumentRepo = new DrizzleRenterDocumentRepository(db)
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
    const bookingEventRepo = new InMemoryBookingEventRepository()
    runInTransaction = async (fn) =>
      fn({
        vehicleRepo,
        maintenanceLogRepo,
        bookingRepo,
        bookingEventRepo,
        locationRepo,
        insuranceOptionRepo,
        addOnRepo,
        feeScheduleRepo,
      })
    userRepo = new InMemoryUserRepository()
    photoStorage = new InMemoryPhotoStorage()
    renterDocumentRepo = new InMemoryRenterDocumentRepository()
    documentStorage = new InMemoryDocumentStorage()
    customerRepo = new InMemoryCustomerRepository(new Map(), new Map())
    operatorRepo = new InMemoryOperatorRepository()
    locationRepo = new InMemoryLocationRepository()
    insuranceOptionRepo = new InMemoryInsuranceOptionRepository()
    addOnRepo = new InMemoryAddOnRepository()
    feeScheduleRepo = new InMemoryFeeScheduleRepository()
    notificationLogRepo = new InMemoryNotificationLogRepository()
    storefrontRepo = new InMemoryStorefrontRepository(locationRepo, operatorRepo)
    paymentEventRepo = new InMemoryPaymentEventRepository()
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

  // Outbound email: real Resend when the key is set. In production without a key,
  // a sentinel throws on first use (not at boot). In dev, a console stub logs the
  // send so flows work end-to-end without a vendor account. Mirrors translationProvider.
  const emailSender: EmailSender = (() => {
    const key = process.env.RESEND_API_KEY
    const from = process.env.EMAIL_FROM ?? ''
    if (key) return new ResendEmailSender(key, from)
    if (process.env.NODE_ENV === 'production') {
      return {
        send: async () => {
          throw new Error('RESEND_API_KEY not configured')
        },
      }
    }
    return {
      send: async (m) => {
        console.info('[email:dev]', m.to, m.subject)
        return { providerMessageId: 'dev' }
      },
    }
  })()

  // In-app Stripe payment (#461). Real gateway when BOTH secrets are set; in
  // production without them a sentinel throws on first use (not at boot, so
  // unrelated tests still construct the app). In dev a stub hands back the
  // success URL so the flow is navigable, but webhook verification always
  // throws (no secret) so nothing is recorded without real wiring. An override
  // (tests) wins outright. Mirrors emailSender / translationProvider.
  const paymentGateway: PaymentGateway =
    overrides?.paymentGateway ??
    (() => {
      const secretKey = process.env.STRIPE_SECRET_KEY
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
      if (secretKey && webhookSecret) return new StripePaymentGateway(secretKey, webhookSecret)
      if (process.env.NODE_ENV === 'production') {
        return {
          createCheckoutSession: async () => {
            throw new Error('STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not configured')
          },
          parseWebhookEvent: async () => {
            throw new Error('STRIPE_WEBHOOK_SECRET not configured')
          },
        }
      }
      return {
        createCheckoutSession: async (p) => {
          console.info('[payment:dev] checkout session for', p.bookingCode)
          return { sessionId: 'dev', url: p.successUrl }
        },
        parseWebhookEvent: async () => {
          throw new Error('Stripe not configured (dev): cannot verify webhook')
        },
      }
    })()
  // Renter is redirected back here after Stripe Checkout — the first allowed web
  // origin (success/cancel paths are appended in the service).
  const paymentWebBaseUrl = resolveAllowedOrigins(process.env.WEB_ORIGIN)[0] ?? ''
  const paymentService = new PaymentService(paymentEventRepo, bookingRepo, paymentGateway, {
    webBaseUrl: paymentWebBaseUrl,
  })

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

  // CSRF guard for the cookie session (design spec §5.4). Must run before the
  // route-auth guards so a forged cookie-authenticated mutation is rejected
  // (403) before any handler work. No-op for safe methods and cookie-less
  // Bearer/API-key callers — see middleware/csrf.ts.
  app.use('*', csrf())

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
  app.use('/documents/*', requireAuth())
  app.use('/documents', requireAuth())
  // locations + operators are auth-gated inside their factories (no public
  // routes), mirroring createVehicleClassRoutes — no app-level use() needed.

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
  // Single post-commit seam (#393): thread autocreate (#335) + outbound
  // notifications, awaited in the service, each caught-and-logged.
  const notificationDispatcher = new NotificationDispatcher(
    notificationLogRepo,
    operatorRepo,
    vehicleRepo,
    userRepo,
    locationRepo,
    emailSender,
    {
      emailFrom: process.env.EMAIL_FROM ?? '',
      emailReplyTo: process.env.EMAIL_REPLY_TO,
      fallbackOperatorEmail:
        process.env.OPERATOR_ALERT_FALLBACK_EMAIL ??
        process.env.EMAIL_REPLY_TO ??
        process.env.EMAIL_FROM,
    },
  )
  const ensureThread = staffUserId ? makeEnsureThread({ threadRepo, staffUserId }) : async () => {}
  const postCommit = new BookingPostCommitDispatcher(ensureThread, notificationDispatcher)
  const renterDocumentService = new RenterDocumentService(renterDocumentRepo, documentStorage)
  // #459: gate new bookings on renter document verification only when the flag
  // is explicitly on. Default OFF keeps the booking flow (and its 900+ tests,
  // the #390 demo, #460/#461) untouched. When on, an unverified renter is 403'd
  // before any booking work.
  const verificationGate = parseBoolFlag(process.env.REQUIRE_DOCUMENT_VERIFICATION)
    ? documentVerificationGate(renterDocumentService)
    : undefined
  const bookingService = new BookingService(
    bookingRepo,
    runInTransaction,
    vehicleRepo,
    userRepo,
    vehicleClassRepo,
    postCommit,
    operatorRepo,
    undefined,
    verificationGate,
  )
  const notificationService = new NotificationService(
    notificationLogRepo,
    bookingRepo,
    notificationDispatcher,
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
  // #407: the write-operator resolver is a pure policy function — sole-operator
  // inference is retired, so it no longer needs an operator lookup.
  const resolveWriteOperatorId: ResolveWriteOperatorId = (ctx, inputOperatorId) =>
    resolveOperatorIdForWrite(ctx, inputOperatorId)
  const locationService = new LocationService(locationRepo, bookingRepo)
  const insuranceOptionService = new InsuranceOptionService(insuranceOptionRepo)
  const addOnService = new AddOnService(addOnRepo)
  const feeScheduleService = new FeeScheduleService(feeScheduleRepo)
  const storefrontSearchService = new StorefrontSearchService(
    storefrontRepo,
    availabilityRepo,
    vehicleClassRepo,
  )
  const storefrontDetailService = new StorefrontDetailService(
    storefrontRepo,
    availabilityRepo,
    vehicleClassRepo,
    insuranceOptionRepo,
    addOnRepo,
  )

  // Chain .route() calls so TypeScript infers the full route type tree.
  // hc<AppType> needs this to produce typed client methods.
  return app
    .route('/', health)
    .route('/', createAuthRoutes(resolveGoogleOAuthConfig(), googleAuthRuntime))
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
    .route(
      '/',
      createStorefrontRoutes(
        storefrontSearchService,
        storefrontDetailService,
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
    .route('/', createPaymentRoutes(paymentService))
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
    .route('/', createLocationRoutes(locationService, resolveWriteOperatorId))
    .route('/', createInsuranceOptionRoutes(insuranceOptionService, resolveWriteOperatorId))
    .route('/', createAddOnRoutes(addOnService, resolveWriteOperatorId))
    .route('/', createFeeScheduleRoutes(feeScheduleService, resolveWriteOperatorId))
    .route('/', createNotificationRoutes(notificationService))
    .route('/', createOperatorRoutes(operatorService))
    .route('/', createDocumentRoutes(renterDocumentService))
}

/**
 * Resolve Google OAuth config from env, or undefined when unconfigured (local
 * dev / CI without secrets) — the /auth/google/* routes then return 503 rather
 * than crashing at boot. redirect_uri is derived from AUTH_URL so it always
 * matches the deployed origin; the post-login target defaults to the first
 * allowed web origin.
 */
function resolveGoogleOAuthConfig(): GoogleOAuthConfig | undefined {
  const clientId = process.env.AUTH_GOOGLE_ID
  const clientSecret = process.env.AUTH_GOOGLE_SECRET
  const authUrl = process.env.AUTH_URL
  if (!clientId || !clientSecret || !authUrl) return undefined

  const base = authUrl.replace(/\/$/, '')
  const postLoginRedirect =
    process.env.WEB_POST_LOGIN_URL ?? resolveAllowedOrigins(process.env.WEB_ORIGIN)[0] ?? base
  return {
    clientId,
    clientSecret,
    redirectUri: `${base}/auth/google/callback`,
    postLoginRedirect,
  }
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
