import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { jstDateString } from '@kuruma/shared/lib/compliance'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { AppOverrides } from './app-overrides'
import { isStaleOperatorSession } from './auth/session-freshness'
import { buildFxRateProvider } from './composition/fx'
import { type Repos, buildRepos } from './composition/repositories'
import {
  resolveAllowedOrigins,
  resolveEmailConfig,
  resolveEmailSender,
  resolveGeocoder,
  resolveGoogleOAuthConfig,
  resolveOperatorAlertEmail,
  resolvePaymentGateway,
} from './composition/services'
import { setupGlobalHandlers } from './error-handlers'
import { parseBoolFlag } from './lib/parse-bool-flag'
import {
  provideOperatorSessionRevocation,
  requireAuth,
  requirePlatformMember,
} from './middleware/auth'
import { csrf } from './middleware/csrf'
import { structuredLogger } from './middleware/logger'
import { requestId } from './middleware/request-id'
import { observability } from './observability/middleware'
import { createAddOnTemplateRoutes } from './routes/add-on-templates'
import { createAddOnRoutes } from './routes/add-ons'
import { createAdminRoutes } from './routes/admin'
import { createAdminBookingRoutes } from './routes/admin-bookings'
import { createAdminConsentRoutes } from './routes/admin-consent'
import { createAdminOperatorApplicationRoutes } from './routes/admin-operator-applications'
import { createAdminOperatorRoutes } from './routes/admin-operators'
import { createAdminOverviewRoutes } from './routes/admin-overview'
import { createAdminRevenueRoutes } from './routes/admin-revenue'
import { createAdminReviewRoutes } from './routes/admin-reviews'
import { createAdminTemplateRoutes } from './routes/admin-templates'
import { createAuthRoutes } from './routes/auth'
import { createAvailabilityRoutes } from './routes/availability'
import { createBookingRoutes } from './routes/bookings'
import { createConsentRoutes } from './routes/consent'
import { createCustomerRoutes } from './routes/customers'
import { createDocumentRoutes } from './routes/documents'
import { createFeatureFlagsRoutes } from './routes/feature-flags'
import { createFeeScheduleRoutes } from './routes/fee-schedules'
import { createFleetOverviewRoutes } from './routes/fleet-overview'
import { createFxRoutes } from './routes/fx'
import health from './routes/health'
import { createInsuranceOptionRoutes } from './routes/insurance-options'
import { createLocationRoutes } from './routes/locations'
import { createMaintenanceLogRoutes } from './routes/maintenance-logs'
import { createMessageRoutes } from './routes/messages'
import { createNotificationRoutes } from './routes/notifications'
import { createOperatorApplicationRoutes } from './routes/operator-applications'
import { createOperatorTeamRoutes } from './routes/operator-team'
import { createOperatorTermsRoutes } from './routes/operator-terms'
import { createOperatorRoutes } from './routes/operators'
import { createOverviewRoutes } from './routes/overview'
import { createPaymentAnomalyRoutes } from './routes/payment-anomalies'
import { createPaymentRoutes } from './routes/payments'
import { createProviderInviteRoutes } from './routes/provider-invites'
import { rateLimitByIpExcept } from './routes/rate-limit'
import { createRegionRoutes } from './routes/regions'
import { createReviewAggregateRoutes } from './routes/review-aggregates'
import { createReviewListRoutes } from './routes/review-list'
import { createReviewRoutes } from './routes/reviews'
import { createFlatSearchRoutes } from './routes/search'
import { createStatsRoutes } from './routes/stats'
import { createStorefrontRoutes } from './routes/storefronts'
import { createTranslateRoutes } from './routes/translate'
import { createUserRoutes } from './routes/users'
import { createVehicleBlockRoutes } from './routes/vehicle-blocks'
import { createVehicleClassRoutes } from './routes/vehicle-classes'
import { createVehicleDetailRoutes } from './routes/vehicle-detail'
import { createVehiclePhotoRoutes } from './routes/vehicle-photos'
import { createVehicleRoutes } from './routes/vehicles'
import { AddOnService } from './services/add-on'
import { AddOnTemplateService } from './services/add-on-template'
import { AdminBookingService } from './services/admin-booking'
import { AdminOverviewService } from './services/admin-overview'
import { AdminRevenueService } from './services/admin-revenue'
import { type RecordAuditEvent, toAuditRow } from './services/audit'
import { AvailabilityService } from './services/availability'
import { BookingService } from './services/booking'
import { BookingPostCommitDispatcher } from './services/booking-post-commit-dispatcher'
import { ClassOfferingService } from './services/class-offering'
import { ComplianceDigestService } from './services/compliance-digest'
import { ConsentService } from './services/consent'
import { ConsentEvidenceService } from './services/consent-evidence'
import { ConsentGateService } from './services/consent-gate'
import { ConsentGovernanceService } from './services/consent-governance'
import { resolveSigningKey } from './services/consent-signing'
import { CustomerService } from './services/customer'
import { MachineDescriptionTranslator } from './services/description-translation'
import { documentVerificationGate } from './services/document-verification-gate'
import type { EmailSender } from './services/email/email-sender'
import { makeEnsureThread } from './services/ensure-thread'
import { FeatureFlagsService } from './services/feature-flags'
import { FeeScheduleService } from './services/fee-schedule'
import { FlatSearchService } from './services/flat-search'
import { FleetOverviewService } from './services/fleet-overview'
import { InsuranceOptionService } from './services/insurance-option'
import { LocationService } from './services/location'
import { MaintenanceService } from './services/maintenance'
import { MessageService } from './services/message'
import { MessageTranslationService } from './services/message-translation'
import { NotificationService } from './services/notification'
import { NotificationDispatcher } from './services/notification-dispatcher'
import { NotificationRetryService } from './services/notification-retry'
import { OperatorService } from './services/operator'
import { OperatorApplicationService } from './services/operator-application'
import { createOperatorGrantService } from './services/operator-grant'
import {
  makeResolveOperatorRecipients,
  makeResolveOperatorRecipientsBatch,
} from './services/operator-recipients'
import { OperatorSummaryService } from './services/operator-summary'
import { OperatorTeamService } from './services/operator-team'
import { OperatorTermsService } from './services/operator-terms'
import { OverviewService } from './services/overview'
import { PaymentAnomalyService } from './services/payment-anomaly'
import { CancellationRefundReconciler } from './services/payment/cancellation-refund-reconciler'
import { PaymentService } from './services/payment/payment'
import { ProviderInviteService } from './services/provider-invite'
import { RenterDocumentService } from './services/renter-document'
import { ReviewService } from './services/review'
import { ReviewAggregateService } from './services/review-aggregate'
import { ReviewListService } from './services/review-list'
import { StorefrontDetailService } from './services/storefront-detail'
import { StorefrontSearchService } from './services/storefront-search'
import { TemplateLibraryService } from './services/template-library'
import { createTranslationProvider } from './services/translation-provider-factory'
import { UserDirectoryService } from './services/user-directory'
import { VehicleService } from './services/vehicle'
import { VehicleBlockService } from './services/vehicle-block'
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
    vehicleBlockRepo,
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
    addOnTemplateRepo,
    insuranceTemplateRepo,
    feeScheduleRepo,
    notificationLogRepo,
    storefrontRepo,
    regionRepo,
    paymentEventRepo,
    paymentRefundRepo,
    paymentAnomalyRepo,
    providerInviteRepo,
    operatorMembershipRepo,
    operatorApplicationRepo,
    auditLogRepo,
    bookingEventRepo,
    reviewRepo,
    featureFlagRepo,
    consentRepo,
    classRatePlanRepo,
    complianceAlertLogRepo,
    runInTransaction,
    runOperatorGrant,
    runOperatorApproval,
    photosPublicUrl,
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
  const operatorApplicationLimiter =
    overrides?.operatorApplicationLimiter ??
    ((globalThis as Record<string, unknown>).OPERATOR_APPLICATION_LIMITER as
      | RateLimitBinding
      | undefined)
  const messageSendLimiter =
    overrides?.messageSendLimiter ??
    ((globalThis as Record<string, unknown>).MESSAGE_SEND_LIMITER as RateLimitBinding | undefined)
  const messageTranslateLimiter =
    overrides?.messageTranslateLimiter ??
    ((globalThis as Record<string, unknown>).MESSAGE_TRANSLATE_LIMITER as
      | RateLimitBinding
      | undefined)

  const translationProvider = createTranslationProvider()

  const emailSender = resolveEmailSender(overrides)

  // Geocoder stack (provider + throttle + cache) resolved in composition/services.
  const cachedGeocoder = resolveGeocoder(overrides)

  // Indicative FX rates (#1070): static snapshot → daily cache → KV/in-process,
  // built in composition/fx.ts (index.ts is at its size cap). Display-only.
  const fxRateProvider = buildFxRateProvider(overrides)

  // In-app Stripe payment (#461). Real gateway when BOTH secrets are set; in
  // production without them a sentinel throws on first use (not at boot, so
  // unrelated tests still construct the app). In dev a stub hands back the
  // success URL so the flow is navigable, but webhook verification always
  // throws (no secret) so nothing is recorded without real wiring. An override
  // (tests) wins outright. Mirrors emailSender / translationProvider.
  const paymentGateway = resolvePaymentGateway(overrides)
  // Renter is redirected back here after Stripe Checkout — the first allowed web
  // origin (success/cancel paths are appended in the service).
  // First allowed web origin — where the browser is sent back to after Stripe
  // Checkout and the base of the one-time provider-invite link (#521 §7).
  const webBaseUrl = resolveAllowedOrigins(process.env.WEB_ORIGIN)[0] ?? ''
  const paymentService = new PaymentService(
    paymentEventRepo,
    paymentRefundRepo,
    bookingRepo,
    paymentGateway,
    paymentAnomalyRepo,
    { webBaseUrl },
  )
  // #930: one durable audit sink for every #914 service seam. Each service emits
  // its narrow event; this funnels them through the pure toAuditRow mapper into
  // the append-only ledger. Fire-and-forget — a failed audit write must never
  // break the user action that triggered it, so it's logged, never awaited/thrown.
  const recordAudit: RecordAuditEvent = (event) => {
    void auditLogRepo.insert(toAuditRow(event)).catch((error) => {
      console.error('[audit] failed to persist event', event.type, error)
    })
  }
  const providerInviteService = new ProviderInviteService(
    providerInviteRepo,
    operatorRepo,
    { webBaseUrl },
    recordAudit,
  )
  const operatorApplicationService = new OperatorApplicationService(
    operatorApplicationRepo,
    recordAudit,
    runOperatorApproval,
    { webBaseUrl },
  )
  // #904: operator self-service team page. Reuses providerInviteService to mint
  // (so the audit trail + TTL stay single-sourced); reads invites + members
  // scoped to the caller's own operatorId.
  const operatorTeamService = new OperatorTeamService(
    providerInviteRepo,
    operatorMembershipRepo,
    userRepo,
    providerInviteService,
    recordAudit,
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
  // (#580) rather than bypassing via a shared "" key. The Stripe webhook is
  // EXEMPT (#1377): it is signature-gated and would share one per-IP bucket
  // across all of Stripe's source IPs, so a budget there could drop payments.
  const rateLimiter = (globalThis as Record<string, unknown>).RATE_LIMITER as
    | RateLimitBinding
    | undefined
  if (rateLimiter) {
    app.use('*', rateLimitByIpExcept(rateLimiter))
  }

  // CSRF guard for the cookie session (design spec §5.4). Must run before the
  // route-auth guards so a forged cookie-authenticated mutation is rejected
  // (403) before any handler work. No-op for safe methods and cookie-less
  // Bearer/API-key callers — see middleware/csrf.ts.
  app.use('*', csrf())

  // #939: instant operator-session revocation. A deactivated member keeps a valid
  // JWT for the <=7d TTL because verifyJwt is pure crypto; re-read the users
  // projection the token was minted from and reject any operator token that no
  // longer matches. Operator roles only — renter/admin/partner callers skip the
  // read. Registered before every requireAuth (app-level + factory-internal) so
  // the check reaches all operator-reachable routes.
  app.use(
    '*',
    provideOperatorSessionRevocation(async (user) => {
      const projection = (await userRepo.findByIds([user.id]))[0]
      // #1088 operator-level cascade: enrich the projection with the member's
      // operator deactivation so soft-deactivating a whole operator revokes every
      // member (their users row stays intact). One PK lookup, gated to projections
      // that still carry an operatorId; only operator-role tokens reach this check.
      const operatorDeactivatedAt =
        projection?.operatorId != null
          ? ((await operatorRepo.findById(projection.operatorId))?.deactivatedAt ?? null)
          : null
      return isStaleOperatorSession(
        user,
        projection ? { ...projection, operatorDeactivatedAt } : undefined,
      )
    }),
  )

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
  app.use('/consent/*', requireAuth())
  app.use('/customers/*', requireAuth())
  app.use('/customers', requireAuth())
  app.use('/users/*', requireAuth())
  app.use('/admin/*', requireAuth())
  // Structural role gate (#1164): the whole /admin/* surface is platform-tier only,
  // so a future sibling route that forgets its in-body requirePlatform* call is still
  // authz-protected. Per-handler gates remain as defense-in-depth. Authn before authz.
  app.use('/admin/*', requirePlatformMember())
  app.use('/documents/*', requireAuth())
  app.use('/documents', requireAuth())
  // locations + operators are auth-gated inside their factories (no public
  // routes), mirroring createVehicleClassRoutes — no app-level use() needed.

  const vehicleClassService = new VehicleClassService(
    vehicleClassRepo,
    vehicleRepo,
    bookingRepo,
    photosPublicUrl,
  )
  const vehicleClassAvailabilityService = new VehicleClassAvailabilityService(
    vehicleClassRepo,
    vehicleRepo,
    availabilityRepo,
    operatorRepo,
  )
  // Messaging: every confirmed booking auto-creates the renter's coordination
  // thread. Operators read-scope by thread.operatorId (#1205), so the thread
  // carries the renter alone — the old shared DEFAULT_STAFF_ID participant
  // (one global staff user seeded into EVERY tenant's threads) was dead weight
  // and a latent cross-tenant membership, so it is gone.
  // Single post-commit seam (#393): thread autocreate (#335) + outbound
  // notifications, awaited in the service, each caught-and-logged. The dispatcher
  // wiring is shared with the #1125 retry-sweep cron via resolveNotificationDispatcher.
  const notificationDispatcher = resolveNotificationDispatcher(repos, emailSender, webBaseUrl)
  const ensureThread = makeEnsureThread({ threadRepo })
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
    // #851: PaymentService coordinates the auto-refund on cancel (isBookingPaid +
    // initiateCancellationRefund). It's constructed above with the same repos.
    paymentService,
  )
  const notificationService = new NotificationService(
    notificationLogRepo,
    bookingRepo,
    notificationDispatcher,
  )
  const availabilityService = new AvailabilityService(availabilityRepo)
  const customerService = new CustomerService(customerRepo, userRepo, bookingRepo)
  // #1205: a renter's first unread message (the operator-unread 0->1 transition)
  // fires the operator alert through the SAME dispatcher as booking notifications
  // (idempotent per messageId, recipient-resolved to the operator member set).
  const messageService = new MessageService(threadRepo, messageRepo, (args) =>
    notificationDispatcher.dispatchOperatorNewMessage(args).then(() => undefined),
  )
  // Default signing key resolves from CONSENT_SIGNING_KEY (absent ⇒ unsigned rows).
  const consentService = new ConsentService(consentRepo)
  // #877 2b: pure policy gate over the same re-consent query; renter booking
  // creation consults it (booking-only scope, the legally load-bearing chokepoint).
  const consentGate = new ConsentGateService(consentService)
  // #877: assembles verified evidence bundles; exposed via platform-admin route (Task 8).
  const consentEvidenceService = new ConsentEvidenceService(consentRepo, (keyId) => {
    const k = resolveSigningKey()
    return k && k.keyId === keyId ? k : undefined
  })
  // #1091: platform-admin read-only governance browse over the same ledger.
  const consentGovernanceService = new ConsentGovernanceService(consentRepo)
  const userDirectoryService = new UserDirectoryService(userRepo, threadRepo)
  const maintenanceService = new MaintenanceService(
    vehicleRepo,
    maintenanceLogRepo,
    runInTransaction,
  )
  const vehicleBlockService = new VehicleBlockService(vehicleRepo, vehicleBlockRepo, bookingRepo)
  const fleetOverviewService = new FleetOverviewService(fleetOverviewRepo)
  const overviewService = new OverviewService(overviewRepo)
  const adminRevenueService = new AdminRevenueService(paymentEventRepo, operatorRepo)
  const adminBookingService = new AdminBookingService(bookingRepo, operatorRepo, userRepo)
  const adminOverviewService = new AdminOverviewService(
    bookingRepo,
    paymentEventRepo,
    vehicleRepo,
    operatorRepo,
    paymentAnomalyRepo,
    renterDocumentRepo,
  )
  const paymentAnomalyService = new PaymentAnomalyService(paymentAnomalyRepo)
  const vehicleDetailService = new VehicleDetailService(vehicleDetailRepo)
  const operatorService = new OperatorService(operatorRepo, recordAudit, vehicleRepo)
  const operatorSummaryService = new OperatorSummaryService(
    operatorRepo,
    vehicleRepo,
    bookingRepo,
    complianceAlertLogRepo,
  )
  // #407: the write-operator resolver is a pure policy function — sole-operator
  // inference is retired, so it no longer needs an operator lookup.
  const resolveWriteOperatorId: ResolveWriteOperatorId = (ctx, inputOperatorId) =>
    resolveOperatorIdForWrite(ctx, inputOperatorId)
  const operatorTermsService = new OperatorTermsService(consentRepo)
  const vehicleService = new VehicleService(vehicleRepo, resolveWriteOperatorId, photosPublicUrl)
  const locationService = new LocationService(locationRepo, bookingRepo, cachedGeocoder, regionRepo)
  const insuranceOptionService = new InsuranceOptionService(insuranceOptionRepo)
  const featureFlagsService = new FeatureFlagsService(featureFlagRepo)
  // #1437: SHARED_CATALOG is server-enforced. Both the operator picker read (empty when
  // off) and the add-on create path (reject a templateId when off) gate on ONE narrow
  // thunk (ISP) rather than the whole FeatureFlagsService.
  const isSharedCatalogEnabled = () => featureFlagsService.isEnabled('SHARED_CATALOG')
  const addOnService = new AddOnService(
    addOnRepo,
    addOnTemplateRepo,
    new MachineDescriptionTranslator(translationProvider),
    isSharedCatalogEnabled,
  )
  const addOnTemplateService = new AddOnTemplateService(
    addOnTemplateRepo,
    addOnRepo,
    isSharedCatalogEnabled,
  )
  const templateLibraryService = new TemplateLibraryService(
    addOnTemplateRepo,
    insuranceTemplateRepo,
  )
  const feeScheduleService = new FeeScheduleService(feeScheduleRepo)
  const storefrontSearchService = new StorefrontSearchService(
    storefrontRepo,
    availabilityRepo,
    vehicleClassRepo,
    regionRepo,
  )
  const classOfferingService = new ClassOfferingService(classRatePlanRepo, availabilityRepo)
  const storefrontDetailService = new StorefrontDetailService(
    storefrontRepo,
    availabilityRepo,
    vehicleClassRepo,
    insuranceOptionRepo,
    addOnRepo,
    classOfferingService,
  )
  const flatSearchService = new FlatSearchService(
    storefrontRepo,
    availabilityRepo,
    vehicleClassRepo,
    regionRepo,
    classOfferingService,
  )
  const reviewService = new ReviewService(
    reviewRepo,
    bookingRepo,
    vehicleRepo,
    bookingEventRepo,
    operatorMembershipRepo,
  )
  const reviewAggregateService = new ReviewAggregateService(reviewRepo)
  const reviewListService = new ReviewListService(reviewRepo, userRepo)

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
    .route(
      '/',
      createOperatorApplicationRoutes(operatorApplicationService, operatorApplicationLimiter),
    )
    .route('/', createRegionRoutes(regionRepo))
    .route('/', createFxRoutes(fxRateProvider))
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
    .route('/', createVehicleBlockRoutes(vehicleBlockService))
    .route('/', createBookingRoutes(bookingService, consentGate))
    .route('/', createReviewRoutes(reviewService))
    .route('/', createAdminReviewRoutes(reviewService))
    .route('/', createReviewAggregateRoutes(reviewAggregateService, publicCatalogLimiter))
    .route('/', createReviewListRoutes(reviewListService, publicCatalogLimiter))
    .route('/', createPaymentRoutes(paymentService))
    .route('/', createAvailabilityRoutes(availabilityService))
    .route('/', createStatsRoutes(statsRepo))
    .route('/', createOverviewRoutes(overviewService))
    .route('/', createAdminRevenueRoutes(adminRevenueService))
    .route('/', createAdminBookingRoutes(adminBookingService))
    .route('/', createAdminOperatorRoutes(operatorService, operatorSummaryService))
    .route('/', createAdminOperatorApplicationRoutes(operatorApplicationService))
    .route('/', createFeatureFlagsRoutes(featureFlagsService))
    .route('/', createAdminOverviewRoutes(adminOverviewService))
    .route('/', createPaymentAnomalyRoutes(paymentAnomalyService))
    .route('/', createMessageRoutes(messageService, messageSendLimiter))
    .route('/', createConsentRoutes(consentService))
    .route('/', createAdminConsentRoutes(consentGovernanceService))
    .route(
      '/',
      createTranslateRoutes(
        new MessageTranslationService(messageRepo, translationProvider),
        messageTranslateLimiter,
      ),
    )
    .route('/', createCustomerRoutes(customerService))
    .route('/', createUserRoutes(userDirectoryService))
    .route('/', createAdminRoutes(operatorService, providerInviteService, consentEvidenceService))
    .route('/', createLocationRoutes(locationService, resolveWriteOperatorId))
    .route('/', createInsuranceOptionRoutes(insuranceOptionService, resolveWriteOperatorId))
    .route('/', createAddOnRoutes(addOnService, resolveWriteOperatorId))
    .route('/', createOperatorTermsRoutes(operatorTermsService, resolveWriteOperatorId))
    .route('/', createAddOnTemplateRoutes(addOnTemplateService))
    .route('/', createAdminTemplateRoutes(templateLibraryService))
    .route('/', createFeeScheduleRoutes(feeScheduleService, resolveWriteOperatorId))
    .route('/', createNotificationRoutes(notificationService))
    .route('/', createOperatorRoutes(operatorService))
    .route('/', createOperatorTeamRoutes(operatorTeamService))
    .route('/', createDocumentRoutes(renterDocumentService))
}

/**
 * The notification dispatcher wiring, shared by createApp's post-commit seam and
 * the #1125 retry-sweep cron so the two never drift on recipient resolution,
 * fallback inbox, or deep-link base. Caller passes the already-resolved email
 * sender + web origin so createApp reuses its locals (no double-construction).
 */
function resolveNotificationDispatcher(
  repos: Repos,
  emailSender: EmailSender,
  webBaseUrl: string,
): NotificationDispatcher {
  const {
    notificationLogRepo,
    operatorRepo,
    vehicleRepo,
    userRepo,
    operatorMembershipRepo,
    locationRepo,
  } = repos
  return new NotificationDispatcher(
    notificationLogRepo,
    operatorRepo,
    vehicleRepo,
    userRepo,
    makeResolveOperatorRecipients({ membershipRepo: operatorMembershipRepo, userRepo }),
    locationRepo,
    emailSender,
    {
      ...resolveEmailConfig(),
      fallbackOperatorEmail: resolveOperatorAlertEmail(),
      // #960: empty string (WEB_ORIGIN unset) -> the dispatcher omits the deep link.
      webBaseUrl,
    },
  )
}

/**
 * Composition seam for the #916 §5.4 daily compliance digest, resolved by the
 * Workers `scheduled` cron the same way routes resolve `createApp`. Wires the
 * fleet scan, the idempotency ledger, the active-member recipient resolver
 * (the batch sibling of the booking dispatcher's, #1010), the JST clock, and
 * the email sender.
 */
export function buildComplianceDigestService(
  overrides?: AppOverrides,
  repos: Repos = buildRepos(overrides),
): ComplianceDigestService {
  const { vehicleRepo, complianceAlertLogRepo, operatorMembershipRepo, userRepo } = repos
  return new ComplianceDigestService({
    vehicleRepo,
    alertLogRepo: complianceAlertLogRepo,
    resolveRecipients: makeResolveOperatorRecipientsBatch({
      membershipRepo: operatorMembershipRepo,
      userRepo,
    }),
    emailSender: resolveEmailSender(overrides),
    today: () => jstDateString(new Date()),
    config: resolveEmailConfig(),
  })
}

/**
 * Composition seam for the #851 refund-on-cancellation reconciler backstop,
 * resolved by the Workers `scheduled` cron exactly as buildComplianceDigestService
 * is. Wires the bounded REFUND_DUE scan, the idempotent refund core (PaymentService
 * as the driver — same Stripe gateway/origin createApp uses), and the refund
 * receipt repo for the post-drive outcome tally.
 */
export function buildCancellationRefundReconciler(
  overrides?: AppOverrides,
  repos: Repos = buildRepos(overrides),
): CancellationRefundReconciler {
  const {
    paymentEventRepo,
    paymentRefundRepo,
    bookingRepo,
    paymentAnomalyRepo,
    refundReconcilerRepo,
  } = repos
  const webBaseUrl = resolveAllowedOrigins(process.env.WEB_ORIGIN)[0] ?? ''
  const driver = new PaymentService(
    paymentEventRepo,
    paymentRefundRepo,
    bookingRepo,
    resolvePaymentGateway(overrides),
    paymentAnomalyRepo,
    { webBaseUrl },
  )
  return new CancellationRefundReconciler({
    scanRepo: refundReconcilerRepo,
    driver,
    refundRepo: paymentRefundRepo,
  })
}

/**
 * Composition seam for the #1125 daily notification retry sweep, resolved by the
 * Workers `scheduled` cron exactly as the other backstops are. Re-drives durably
 * stuck notification_log rows through the SAME dispatcher createApp wires (shared
 * via resolveNotificationDispatcher), so a one-shot lifecycle email that failed
 * its first send self-heals instead of waiting on a manual operator resend.
 */
export function buildNotificationRetryService(
  overrides?: AppOverrides,
  repos: Repos = buildRepos(overrides),
): NotificationRetryService {
  const webBaseUrl = resolveAllowedOrigins(process.env.WEB_ORIGIN)[0] ?? ''
  return new NotificationRetryService({
    notificationLogRepo: repos.notificationLogRepo,
    bookingRepo: repos.bookingRepo,
    redriver: resolveNotificationDispatcher(repos, resolveEmailSender(overrides), webBaseUrl),
  })
}

/**
 * Inferred type of the composed app; used by the web client for `hc<AppType>()`.
 * Declared here so consumers can `import type { AppType } from '@kuruma/api'`
 * without triggering any runtime side-effects.
 */
export type AppType = ReturnType<typeof createApp>
