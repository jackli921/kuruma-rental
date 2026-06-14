import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppOverrides } from './app-overrides'
import type { GoogleOAuthConfig } from './auth/google'
import { type Repos, buildRepos } from './composition/repositories'
import { setupGlobalHandlers } from './error-handlers'
import { parseBoolFlag } from './lib/parse-bool-flag'
import { requireAuth } from './middleware/auth'
import { csrf } from './middleware/csrf'
import { structuredLogger } from './middleware/logger'
import { requestId } from './middleware/request-id'
import { observability } from './observability/middleware'
import { createAddOnRoutes } from './routes/add-ons'
import { createAdminRoutes } from './routes/admin'
import { createAdminRevenueRoutes } from './routes/admin-revenue'
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
import { createOverviewRoutes } from './routes/overview'
import { createPaymentAnomalyRoutes } from './routes/payment-anomalies'
import { createPaymentRoutes } from './routes/payments'
import { createProviderInviteRoutes } from './routes/provider-invites'
import { rateLimitByIp } from './routes/rate-limit'
import { createRegionRoutes } from './routes/regions'
import { createFlatSearchRoutes } from './routes/search'
import { createStatsRoutes } from './routes/stats'
import { createStorefrontRoutes } from './routes/storefronts'
import { createTranslateRoutes } from './routes/translate'
import { createUserRoutes } from './routes/users'
import { createVehicleClassRoutes } from './routes/vehicle-classes'
import { createVehicleDetailRoutes } from './routes/vehicle-detail'
import { createVehiclePhotoRoutes } from './routes/vehicle-photos'
import { createVehicleRoutes } from './routes/vehicles'
import { AddOnService } from './services/add-on'
import { AdminRevenueService } from './services/admin-revenue'
import { AvailabilityService } from './services/availability'
import { BookingService } from './services/booking'
import { BookingPostCommitDispatcher } from './services/booking-post-commit-dispatcher'
import { CustomerService } from './services/customer'
import { documentVerificationGate } from './services/document-verification-gate'
import type { EmailSender } from './services/email/email-sender'
import { ResendEmailSender } from './services/email/resend-email-sender'
import { makeEnsureThread } from './services/ensure-thread'
import { FeeScheduleService } from './services/fee-schedule'
import { FlatSearchService } from './services/flat-search'
import { FleetOverviewService } from './services/fleet-overview'
import { NominatimGeocoder } from './services/geocoding/nominatim-geocoder'
import { ThrottledGeocoder } from './services/geocoding/throttled-geocoder'
import type { Geocoder } from './services/geocoding/types'
import { InsuranceOptionService } from './services/insurance-option'
import { LocationService } from './services/location'
import { MaintenanceService } from './services/maintenance'
import { MessageService } from './services/message'
import { MessageTranslationService } from './services/message-translation'
import { NotificationService } from './services/notification'
import { NotificationDispatcher } from './services/notification-dispatcher'
import { OperatorService } from './services/operator'
import { createOperatorGrantService } from './services/operator-grant'
import { OverviewService } from './services/overview'
import { PaymentAnomalyService } from './services/payment-anomaly'
import { PaymentService } from './services/payment/payment'
import type { PaymentGateway } from './services/payment/payment-gateway'
import { StripePaymentGateway } from './services/payment/stripe-payment-gateway'
import { ProviderInviteService } from './services/provider-invite'
import { RenterDocumentService } from './services/renter-document'
import { StorefrontDetailService } from './services/storefront-detail'
import { StorefrontSearchService } from './services/storefront-search'
import { createTranslationProvider } from './services/translation-provider-factory'
import { UserDirectoryService } from './services/user-directory'
import { VehicleService } from './services/vehicle'
import { VehicleClassService } from './services/vehicle-class'
import { VehicleClassAvailabilityService } from './services/vehicle-class-availability'
import { VehicleDetailService } from './services/vehicle-detail'
import { VehiclePhotoService } from './services/vehicle-photo'
import { type ResolveWriteOperatorId, resolveOperatorIdForWrite } from './tenancy'

export function createApp(overrides?: AppOverrides, repos: Repos = buildRepos(overrides)) {
  // Repository wiring lives in the composition bundle: it selects the same
  // override → Drizzle → in-memory branch this function used inline and returns
  // one compiler-enforced bundle, so a new repo can't be added to one branch
  // and forgotten in another. See composition/repositories.ts. The optional
  // `repos` lets a caller (the #634 real-db e2e harness) pass a pre-built bundle
  // — e.g. buildDrizzleRepos backed by a transaction-capable postgres-js db.
  const {
    vehicleClassRepo,
    vehicleRepo,
    bookingRepo,
    availabilityRepo,
    userRepo,
    fleetOverviewRepo,
    vehicleDetailRepo,
    statsRepo,
    overviewRepo,
    threadRepo,
    messageRepo,
    maintenanceLogRepo,
    photoStorage,
    renterDocumentRepo,
    documentStorage,
    customerRepo,
    operatorRepo,
    locationRepo,
    insuranceOptionRepo,
    addOnRepo,
    feeScheduleRepo,
    notificationLogRepo,
    storefrontRepo,
    regionRepo,
    paymentEventRepo,
    paymentAnomalyRepo,
    providerInviteRepo,
    operatorMembershipRepo,
    bookingEventRepo,
    runInTransaction,
    runOperatorGrant,
    googleAuthRuntime,
  } = repos
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

  const translationProvider = createTranslationProvider()

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

  // Forward geocoder (#531): disabled by default (null stub) unless BOTH a
  // User-Agent and an endpoint are set; prod = LocationIQ (Nominatim-compatible,
  // + NOMINATIM_API_KEY) or self-host. The resolved geocoder is wrapped in a
  // ThrottledGeocoder keyed off GEOCODE_LIMITER (#574) — best-effort global cap so
  // a burst can't breach OSMF's 1 req/s. A test override wins outright.
  const innerGeocoder: Geocoder =
    overrides?.geocoder ??
    (() => {
      const userAgent = process.env.NOMINATIM_USER_AGENT
      const baseUrl = process.env.NOMINATIM_API_URL
      // Disabled: every address is "un-geocodable" (no provider), so a save
      // persists with null coords — never PENDING (nothing will ever resolve it).
      if (!userAgent || !baseUrl) return { geocode: async () => ({ status: 'notFound' as const }) }
      return new NominatimGeocoder(baseUrl, userAgent, undefined, process.env.NOMINATIM_API_KEY)
    })()
  // Adapt the native binding's `limit({ key })` to the RateLimiter port here.
  const geocodeLimiter =
    overrides?.geocodeLimiter ??
    ((globalThis as Record<string, unknown>).GEOCODE_LIMITER as RateLimitBinding | undefined)
  const geocoder: Geocoder = geocodeLimiter
    ? new ThrottledGeocoder(innerGeocoder, { limit: (key) => geocodeLimiter.limit({ key }) })
    : innerGeocoder

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
  // First allowed web origin — where the browser is sent back to after Stripe
  // Checkout and the base of the one-time provider-invite link (#521 §7).
  const webBaseUrl = resolveAllowedOrigins(process.env.WEB_ORIGIN)[0] ?? ''
  const paymentService = new PaymentService(
    paymentEventRepo,
    bookingRepo,
    paymentGateway,
    paymentAnomalyRepo,
    { webBaseUrl },
  )
  const providerInviteService = new ProviderInviteService(
    providerInviteRepo,
    operatorRepo,
    { webBaseUrl },
    (event) => console.info('[provider-invite] created', event),
  )
  // Operator-access grant decision (#521 §6) + slug resolver for the OAuth callback.
  // The slug is read from the STORED operators.slug (never re-derived from the name),
  // so /manage/<slug> redirects match the route the web app actually mounts.
  const operatorGrantService = createOperatorGrantService({
    memberships: operatorMembershipRepo,
    invites: providerInviteRepo,
    runGrant: runOperatorGrant,
  })
  const findOperatorSlug = async (operatorId: string): Promise<string | undefined> =>
    (await operatorRepo.findById(operatorId))?.slug

  const app = new Hono()

  // Global error handlers — prevent stack traces leaking to clients.
  setupGlobalHandlers(app)

  // Request ID + structured logging — must be before all other middleware
  // so every request gets a correlation ID and timing.
  app.use('*', requestId())
  app.use('*', structuredLogger())
  // Observability (#361): time the full request and report raw >=500 / slow
  // (>2s) responses to Sentry. Early so the timing spans all downstream work.
  app.use('*', observability())

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
  // dev (binding absent). When present it fails closed on an unresolvable IP
  // (#580) rather than bypassing via a shared "" key.
  const rateLimiter = (globalThis as Record<string, unknown>).RATE_LIMITER as
    | RateLimitBinding
    | undefined
  if (rateLimiter) {
    app.use('*', rateLimitByIp(rateLimiter))
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
  app.use('/availability', requireAuth())
  app.use('/threads/*', requireAuth())
  app.use('/messages/*', requireAuth())
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
    bookingEventRepo,
    undefined,
    verificationGate,
  )
  const notificationService = new NotificationService(
    notificationLogRepo,
    bookingRepo,
    notificationDispatcher,
  )
  const availabilityService = new AvailabilityService(availabilityRepo)
  const customerService = new CustomerService(customerRepo, userRepo)
  const messageService = new MessageService(threadRepo, messageRepo)
  const userDirectoryService = new UserDirectoryService(userRepo, threadRepo)
  const maintenanceService = new MaintenanceService(
    vehicleRepo,
    maintenanceLogRepo,
    runInTransaction,
  )
  const fleetOverviewService = new FleetOverviewService(fleetOverviewRepo)
  const overviewService = new OverviewService(overviewRepo)
  const adminRevenueService = new AdminRevenueService(paymentEventRepo, operatorRepo)
  const paymentAnomalyService = new PaymentAnomalyService(paymentAnomalyRepo)
  const vehicleDetailService = new VehicleDetailService(vehicleDetailRepo)
  const operatorService = new OperatorService(operatorRepo)
  // #407: the write-operator resolver is a pure policy function — sole-operator
  // inference is retired, so it no longer needs an operator lookup.
  const resolveWriteOperatorId: ResolveWriteOperatorId = (ctx, inputOperatorId) =>
    resolveOperatorIdForWrite(ctx, inputOperatorId)
  const vehicleService = new VehicleService(vehicleRepo, resolveWriteOperatorId)
  const locationService = new LocationService(locationRepo, bookingRepo, geocoder, regionRepo)
  const insuranceOptionService = new InsuranceOptionService(insuranceOptionRepo)
  const addOnService = new AddOnService(addOnRepo)
  const feeScheduleService = new FeeScheduleService(feeScheduleRepo)
  const storefrontSearchService = new StorefrontSearchService(
    storefrontRepo,
    availabilityRepo,
    vehicleClassRepo,
    regionRepo,
  )
  const storefrontDetailService = new StorefrontDetailService(
    storefrontRepo,
    availabilityRepo,
    vehicleClassRepo,
    insuranceOptionRepo,
    addOnRepo,
  )
  const flatSearchService = new FlatSearchService(
    storefrontRepo,
    availabilityRepo,
    vehicleClassRepo,
    regionRepo,
  )

  // Chain .route() calls so TypeScript infers the full route type tree.
  // hc<AppType> needs this to produce typed client methods.
  return app
    .route('/', health)
    .route(
      '/',
      createAuthRoutes(
        resolveGoogleOAuthConfig(),
        googleAuthRuntime,
        operatorGrantService,
        findOperatorSlug,
      ),
    )
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
    .route('/', createFlatSearchRoutes(flatSearchService, publicCatalogLimiter))
    .route('/', createProviderInviteRoutes(providerInviteService, publicCatalogLimiter))
    .route('/', createRegionRoutes(regionRepo))
    .route('/', createVehicleRoutes(vehicleService, maintenanceService))
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
    .route('/', createAvailabilityRoutes(availabilityService))
    .route('/', createStatsRoutes(statsRepo))
    .route('/', createOverviewRoutes(overviewService))
    .route('/', createAdminRevenueRoutes(adminRevenueService))
    .route('/', createPaymentAnomalyRoutes(paymentAnomalyService))
    .route('/', createMessageRoutes(messageService))
    .route(
      '/',
      createTranslateRoutes(new MessageTranslationService(messageRepo, translationProvider)),
    )
    .route('/', createCustomerRoutes(customerService))
    .route('/', createUserRoutes(userDirectoryService))
    .route('/', createAdminRoutes(operatorService, providerInviteService))
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
