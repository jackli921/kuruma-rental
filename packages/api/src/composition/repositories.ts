import { type RunTx, getDb, runTx } from '@kuruma/shared/db'
import { photoRefsToWireUrls, wireUrlsToStoredRefs } from '@kuruma/shared/lib/photo-ref'
import type { AppOverrides } from '../app-overrides'
import { DrizzleOAuthAccountStore } from '../auth/drizzle-oauth-account-store'
import { FetchGoogleOAuthProvider } from '../auth/fetch-google-oauth-provider'
import type { GoogleAuthRuntime } from '../auth/google'
import { DisabledDocumentStorage } from '../repositories/disabled-document-storage'
import { DisabledPhotoStorage } from '../repositories/disabled-photo-storage'
import {
  type Db,
  DrizzleAddOnRepository,
  DrizzleAuditLogRepository,
  DrizzleAvailabilityRepository,
  DrizzleBookingEventRepository,
  DrizzleBookingRepository,
  DrizzleComplianceAlertLogRepository,
  DrizzleCustomerRepository,
  DrizzleFeeScheduleRepository,
  DrizzleFleetOverviewRepository,
  DrizzleInsuranceOptionRepository,
  DrizzleLocationRepository,
  DrizzleMaintenanceLogRepository,
  DrizzleMessageRepository,
  DrizzleNotificationLogRepository,
  DrizzleOperatorMembershipRepository,
  DrizzleOperatorRepository,
  DrizzleOverviewRepository,
  DrizzlePaymentAnomalyRepository,
  DrizzlePaymentEventRepository,
  DrizzlePaymentRefundRepository,
  DrizzleProviderInviteRepository,
  DrizzleRefundReconcilerRepository,
  DrizzleRegionRepository,
  DrizzleRenterDocumentRepository,
  DrizzleStatsRepository,
  DrizzleStorefrontRepository,
  DrizzleThreadRepository,
  DrizzleUserRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleDetailRepository,
  DrizzleVehicleRepository,
  createDrizzleOperatorGrant,
  createDrizzleTransaction,
} from '../repositories/drizzle'
import {
  InMemoryAddOnRepository,
  InMemoryAuditLogRepository,
  InMemoryAvailabilityRepository,
  InMemoryBookingEventRepository,
  InMemoryBookingRepository,
  InMemoryComplianceAlertLogRepository,
  InMemoryCustomerRepository,
  InMemoryDocumentStorage,
  InMemoryFeeScheduleRepository,
  InMemoryFleetOverviewRepository,
  InMemoryInsuranceOptionRepository,
  InMemoryLocationRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryMessageRepository,
  InMemoryNotificationLogRepository,
  InMemoryOperatorMembershipRepository,
  InMemoryOperatorRepository,
  InMemoryOverviewRepository,
  InMemoryPaymentAnomalyRepository,
  InMemoryPaymentEventRepository,
  InMemoryPaymentRefundRepository,
  InMemoryProviderInviteRepository,
  InMemoryRefundReconcilerRepository,
  InMemoryRegionRepository,
  InMemoryRenterDocumentRepository,
  InMemoryStatsRepository,
  InMemoryStorefrontRepository,
  InMemoryThreadRepository,
  InMemoryUserRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../repositories/in-memory'
import { InMemoryVehicleDetailRepository } from '../repositories/in-memory-vehicle-detail'
import { InMemoryPhotoStorage } from '../repositories/in-memory/photo-storage'
import { R2DocumentStorage } from '../repositories/r2-document-storage'
import { type R2BucketLike, R2PhotoStorage } from '../repositories/r2-photo-storage'
import type {
  AddOnRepository,
  AuditLogRepository,
  AvailabilityRepository,
  BookingEventRepository,
  BookingRepository,
  ComplianceAlertLogRepository,
  CustomerRepository,
  DocumentStorage,
  FeeScheduleRepository,
  FleetOverviewRepository,
  InsuranceOptionRepository,
  LocationRepository,
  MaintenanceLogRepository,
  MessageRepository,
  NotificationLogRepository,
  OperatorMembershipRepository,
  OperatorRepository,
  OverviewRepository,
  PaymentAnomalyRepository,
  PaymentEventRepository,
  PaymentRefundRepository,
  PhotoStorage,
  ProviderInviteRepository,
  RefundReconcilerRepository,
  RegionRepository,
  RenterDocumentRepository,
  RunInTransaction,
  RunOperatorGrant,
  StatsRepository,
  StorefrontRepository,
  ThreadRepository,
  UserRepository,
  VehicleClassRepository,
  VehicleDetailRepository,
  VehicleRepository,
} from '../repositories/types'
import type { Booking, PaymentRefund } from '../stores'

/**
 * Fail-loud config invariant (#967): when the public photos bucket binding is
 * present, its public base URL MUST be set. An empty base silently disables BOTH
 * the `r2:` re-encode AND the cross-tenant photo-spoof guard (both no-op when
 * `toObjectKey` can't parse the base), so a PATCH'd `${bucketHost}/vehicles/
 * <victim>/x.jpg` would be stored literally and rendered — reopening the IDOR
 * while uploads quietly fall back to DisabledPhotoStorage. Throw at the
 * composition root rather than degrade at runtime (mirrors DisabledPhotoStorage's
 * loud-failure stance). Pure + exported so the invariant is unit-testable without
 * a live DB or R2 binding.
 */
export function assertPhotosBaseConfigured(hasBucket: boolean, photosPublicUrl: string): void {
  if (hasBucket && !photosPublicUrl) {
    throw new Error(
      'VEHICLE_PHOTOS_PUBLIC_URL must be set when the VEHICLE_PHOTOS bucket binding is present: an empty base disables the #967 cross-tenant photo-spoof guard',
    )
  }
}

/**
 * Compiler-enforced bundle of every repository, storage adapter, and
 * transaction runner the services need. The three builders below
 * ({@link buildOverrideRepos}, {@link buildDrizzleRepos},
 * {@link buildInMemoryRepos}) each return exactly this shape, so adding a
 * repository fails to compile until every branch supplies it — closing the
 * "added to Drizzle, forgot in-memory" bug class (#635).
 *
 * `googleAuthRuntime` is the one optional member: only the override (tests) and
 * Drizzle (production) branches build one; absent ⇒ /auth/google/callback 503s.
 */
export type Repos = {
  vehicleClassRepo: VehicleClassRepository
  vehicleRepo: VehicleRepository
  bookingRepo: BookingRepository
  availabilityRepo: AvailabilityRepository
  userRepo: UserRepository
  fleetOverviewRepo: FleetOverviewRepository
  vehicleDetailRepo: VehicleDetailRepository
  statsRepo: StatsRepository
  overviewRepo: OverviewRepository
  threadRepo: ThreadRepository
  messageRepo: MessageRepository
  maintenanceLogRepo: MaintenanceLogRepository
  photoStorage: PhotoStorage
  renterDocumentRepo: RenterDocumentRepository
  documentStorage: DocumentStorage
  customerRepo: CustomerRepository
  operatorRepo: OperatorRepository
  locationRepo: LocationRepository
  insuranceOptionRepo: InsuranceOptionRepository
  addOnRepo: AddOnRepository
  feeScheduleRepo: FeeScheduleRepository
  notificationLogRepo: NotificationLogRepository
  complianceAlertLogRepo: ComplianceAlertLogRepository
  storefrontRepo: StorefrontRepository
  regionRepo: RegionRepository
  paymentEventRepo: PaymentEventRepository
  paymentRefundRepo: PaymentRefundRepository
  refundReconcilerRepo: RefundReconcilerRepository
  paymentAnomalyRepo: PaymentAnomalyRepository
  providerInviteRepo: ProviderInviteRepository
  operatorMembershipRepo: OperatorMembershipRepository
  auditLogRepo: AuditLogRepository
  bookingEventRepo: BookingEventRepository
  runInTransaction: RunInTransaction
  runOperatorGrant: RunOperatorGrant
  // Public R2 bucket base for vehicle photos (#879). Threaded to VehicleService
  // as the anchor for the #967 cross-tenant photo-spoof guard. '' in dev/test
  // (no bucket) ⇒ the guard is inert, matching the no-op encode/decode there.
  photosPublicUrl: string
  googleAuthRuntime: GoogleAuthRuntime | undefined
}

/**
 * Test/local-dev wiring: the three required in-memory repos come from the
 * overrides, every other repo falls back to an in-memory double unless the
 * override supplies one. Mirrors the env-resolved branches so a route suite
 * exercises the same DI graph production runs.
 */
export function buildOverrideRepos(overrides: AppOverrides): Repos {
  const { vehicleRepo, bookingRepo, availabilityRepo } = overrides
  const vehicleClassRepo = overrides.vehicleClassRepo ?? new InMemoryVehicleClassRepository()
  const maintenanceLogRepo = overrides.maintenanceLogRepo ?? new InMemoryMaintenanceLogRepository()
  const bookingEventRepo = new InMemoryBookingEventRepository()
  const userRepo = overrides.userRepo ?? new InMemoryUserRepository()
  const locationRepo = overrides.locationRepo ?? new InMemoryLocationRepository()
  const insuranceOptionRepo =
    overrides.insuranceOptionRepo ?? new InMemoryInsuranceOptionRepository()
  const addOnRepo = overrides.addOnRepo ?? new InMemoryAddOnRepository()
  const feeScheduleRepo = overrides.feeScheduleRepo ?? new InMemoryFeeScheduleRepository()
  const runInTransaction: RunInTransaction = async (fn) =>
    fn({
      vehicleRepo,
      maintenanceLogRepo,
      bookingRepo,
      bookingEventRepo,
      locationRepo,
      insuranceOptionRepo,
      addOnRepo,
      feeScheduleRepo,
      userRepo,
    })
  const fleetOverviewRepo =
    overrides.fleetOverviewRepo ??
    new InMemoryFleetOverviewRepository(vehicleRepo, bookingRepo, new Map(), maintenanceLogRepo)
  const vehicleDetailRepo =
    overrides.vehicleDetailRepo ??
    new InMemoryVehicleDetailRepository(vehicleRepo, bookingRepo, new Map(), maintenanceLogRepo)
  const statsRepo = overrides.statsRepo ?? new InMemoryStatsRepository(vehicleRepo, bookingRepo)
  const overviewRepo =
    overrides.overviewRepo ?? new InMemoryOverviewRepository(vehicleRepo, bookingRepo)
  const threadRepo = overrides.threadRepo ?? new InMemoryThreadRepository()
  const messageRepo =
    overrides.messageRepo ?? new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
  const photoStorage = overrides.photoStorage ?? new InMemoryPhotoStorage()
  const renterDocumentRepo = overrides.renterDocumentRepo ?? new InMemoryRenterDocumentRepository()
  const documentStorage = overrides.documentStorage ?? new InMemoryDocumentStorage()
  const customerRepo =
    overrides.customerRepo ?? new InMemoryCustomerRepository(new Map(), new Map())
  const operatorRepo = overrides.operatorRepo ?? new InMemoryOperatorRepository()
  const notificationLogRepo =
    overrides.notificationLogRepo ?? new InMemoryNotificationLogRepository()
  const complianceAlertLogRepo =
    overrides.complianceAlertLogRepo ?? new InMemoryComplianceAlertLogRepository()
  const storefrontRepo =
    overrides.storefrontRepo ?? new InMemoryStorefrontRepository(locationRepo, operatorRepo)
  const regionRepo = overrides.regionRepo ?? new InMemoryRegionRepository()
  const paymentEventRepo = overrides.paymentEventRepo ?? new InMemoryPaymentEventRepository()
  const paymentRefundRepo = overrides.paymentRefundRepo ?? new InMemoryPaymentRefundRepository()
  // The reconciler scan spans bookings ⋈ payment_refunds; an override path can't
  // introspect arbitrary injected repos' stores, so default to an empty scan —
  // a test exercising the cron injects its own (mirrors paymentRefundRepo above).
  const refundReconcilerRepo =
    overrides.refundReconcilerRepo ?? new InMemoryRefundReconcilerRepository(new Map(), new Map())
  const paymentAnomalyRepo = overrides.paymentAnomalyRepo ?? new InMemoryPaymentAnomalyRepository()
  const providerInviteRepo = overrides.providerInviteRepo ?? new InMemoryProviderInviteRepository()
  const operatorMembershipRepo =
    overrides.operatorMembershipRepo ?? new InMemoryOperatorMembershipRepository()
  const auditLogRepo = new InMemoryAuditLogRepository()
  const runOperatorGrant: RunOperatorGrant = (fn) =>
    fn({ memberships: operatorMembershipRepo, users: userRepo, invites: providerInviteRepo })
  return {
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
    complianceAlertLogRepo,
    storefrontRepo,
    regionRepo,
    paymentEventRepo,
    paymentRefundRepo,
    refundReconcilerRepo,
    paymentAnomalyRepo,
    providerInviteRepo,
    operatorMembershipRepo,
    auditLogRepo,
    bookingEventRepo,
    runInTransaction,
    runOperatorGrant,
    photosPublicUrl: process.env.VEHICLE_PHOTOS_PUBLIC_URL ?? '',
    googleAuthRuntime: overrides.googleAuthRuntime,
  }
}

/**
 * Production wiring: every repository is Drizzle-backed against the singleton
 * `getDb()` connection. Storage adapters resolve from R2 bindings, throwing
 * loudly (Disabled*) when a binding is absent so uploads never "succeed" into
 * the void on CF Workers. Builds the real Google OAuth runtime.
 *
 * `opts` lets the real-db e2e harness (#634) reuse this exact wiring while
 * substituting a transaction-capable postgres-js `db` + matching `runTx`
 * (production's neon-http `getDb()` throws on interactive transactions). The
 * harness consuming the full bundle is what kills the "added a Drizzle repo,
 * forgot to hand-mirror it in the harness" omission class.
 */
export function buildDrizzleRepos(opts?: { db?: Db; runTx?: RunTx }): Repos {
  const db = opts?.db ?? getDb()
  const tx = opts?.runTx ?? runTx
  // #879: stored photos are R2 keys (r2:<key>) or external URLs. The read-
  // serving repos decode them to wire URLs via this injected decoder — built
  // here, the only place the public bucket base is known — so r2: refs never
  // escape a repo and every read surface emits resolvable URLs.
  const photosPublicUrl = process.env.VEHICLE_PHOTOS_PUBLIC_URL ?? ''
  const decodePhotos = (photos: readonly string[]) => photoRefsToWireUrls(photos, photosPublicUrl)
  // The write-side inverse (#879 Slice 3): collapse our own public URLs back to
  // r2:<key> before they hit the column, so stored rows hold refs and the same
  // base round-trips losslessly. R2 storage is only constructed when
  // photosPublicUrl is set, so the encoder and the bucket share one base.
  const encodePhotos = (photos: readonly string[]) => wireUrlsToStoredRefs(photos, photosPublicUrl)
  const vehicleRepo = new DrizzleVehicleRepository(db, decodePhotos, encodePhotos)
  const bookingRepo = new DrizzleBookingRepository(db)
  const userRepo = new DrizzleUserRepository(db)
  const operatorRepo = new DrizzleOperatorRepository(db)
  const operatorMembershipRepo = new DrizzleOperatorMembershipRepository(db)
  const providerInviteRepo = new DrizzleProviderInviteRepository(db)
  const auditLogRepo = new DrizzleAuditLogRepository(db)
  // Real Google OAuth runtime: HTTP provider + Drizzle-backed account store.
  // Built only here (the composition root) so the route stays adapter-agnostic.
  const googleAuthRuntime: GoogleAuthRuntime = {
    provider: new FetchGoogleOAuthProvider(),
    accountStore: new DrizzleOAuthAccountStore(db),
  }
  const vehiclePhotosBucket = (globalThis as Record<string, unknown>).VEHICLE_PHOTOS as
    | R2BucketLike
    | undefined
  // #967: refuse to boot with a bound bucket but no base — the spoof guard would
  // be silently inert. Fail loud here, not at the first malicious PATCH.
  assertPhotosBaseConfigured(Boolean(vehiclePhotosBucket), photosPublicUrl)
  // In the Drizzle branch (production) an InMemory fallback is dangerous —
  // each CF Worker request gets a fresh instance, so uploads "succeed" but
  // return URLs pointing at nothing. DisabledPhotoStorage throws loudly.
  const photoStorage =
    vehiclePhotosBucket && photosPublicUrl
      ? new R2PhotoStorage(vehiclePhotosBucket, photosPublicUrl)
      : new DisabledPhotoStorage()
  // Renter documents live in a PRIVATE R2 bucket (no public URL). Absent the
  // binding (local dev / pre-#304), DisabledDocumentStorage throws loudly so
  // metadata never points at bytes that were never stored.
  const renterDocumentsBucket = (globalThis as Record<string, unknown>).RENTER_DOCUMENTS as
    | R2BucketLike
    | undefined
  const documentStorage = renterDocumentsBucket
    ? new R2DocumentStorage(renterDocumentsBucket)
    : new DisabledDocumentStorage()
  return {
    vehicleClassRepo: new DrizzleVehicleClassRepository(db, decodePhotos, encodePhotos),
    vehicleRepo,
    bookingRepo,
    availabilityRepo: new DrizzleAvailabilityRepository(db, decodePhotos),
    userRepo,
    fleetOverviewRepo: new DrizzleFleetOverviewRepository(db, decodePhotos),
    vehicleDetailRepo: new DrizzleVehicleDetailRepository(db, decodePhotos),
    statsRepo: new DrizzleStatsRepository(db),
    overviewRepo: new DrizzleOverviewRepository(db),
    threadRepo: new DrizzleThreadRepository(db, tx),
    messageRepo: new DrizzleMessageRepository(db, tx),
    maintenanceLogRepo: new DrizzleMaintenanceLogRepository(db),
    photoStorage,
    renterDocumentRepo: new DrizzleRenterDocumentRepository(db),
    documentStorage,
    customerRepo: new DrizzleCustomerRepository(db),
    operatorRepo,
    locationRepo: new DrizzleLocationRepository(db),
    insuranceOptionRepo: new DrizzleInsuranceOptionRepository(db),
    addOnRepo: new DrizzleAddOnRepository(db),
    feeScheduleRepo: new DrizzleFeeScheduleRepository(db),
    notificationLogRepo: new DrizzleNotificationLogRepository(db),
    complianceAlertLogRepo: new DrizzleComplianceAlertLogRepository(db),
    storefrontRepo: new DrizzleStorefrontRepository(db),
    regionRepo: new DrizzleRegionRepository(db),
    paymentEventRepo: new DrizzlePaymentEventRepository(db),
    paymentRefundRepo: new DrizzlePaymentRefundRepository(db),
    refundReconcilerRepo: new DrizzleRefundReconcilerRepository(db),
    paymentAnomalyRepo: new DrizzlePaymentAnomalyRepository(db),
    providerInviteRepo,
    operatorMembershipRepo,
    auditLogRepo,
    bookingEventRepo: new DrizzleBookingEventRepository(db),
    runInTransaction: createDrizzleTransaction(tx, decodePhotos, encodePhotos),
    // Real interactive tx (#493): membership INSERT first so the partial-unique-
    // active index aborts the whole grant on a concurrent double-accept.
    runOperatorGrant: createDrizzleOperatorGrant(tx),
    photosPublicUrl,
    googleAuthRuntime,
  }
}

/**
 * Local-dev wiring (no DATABASE_URL, no overrides): in-memory everything.
 * No Google OAuth runtime (callback 503s) and no R2 — uploads use the
 * in-memory photo store so flows are navigable without external services.
 */
export function buildInMemoryRepos(): Repos {
  const vehicleRepo = new InMemoryVehicleRepository()
  // Booking + refund stores are shared so the reconciler scan (below) joins them
  // exactly as the Drizzle LEFT JOIN does — local-dev parity for the #851 cron.
  const bookingStore = new Map<string, Booking>()
  const refundStore = new Map<string, PaymentRefund>()
  const bookingRepo = new InMemoryBookingRepository(bookingStore)
  const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
  const bookingEventRepo = new InMemoryBookingEventRepository()
  const userRepo = new InMemoryUserRepository()
  const locationRepo = new InMemoryLocationRepository()
  const insuranceOptionRepo = new InMemoryInsuranceOptionRepository()
  const addOnRepo = new InMemoryAddOnRepository()
  const feeScheduleRepo = new InMemoryFeeScheduleRepository()
  const operatorRepo = new InMemoryOperatorRepository()
  const operatorMembershipRepo = new InMemoryOperatorMembershipRepository()
  const providerInviteRepo = new InMemoryProviderInviteRepository()
  const auditLogRepo = new InMemoryAuditLogRepository()
  // messageRepo wraps the SAME threadRepo instance so reads see threads the
  // message path created (shared in-memory state — matches the prod seam).
  const threadRepo = new InMemoryThreadRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const runInTransaction: RunInTransaction = async (fn) =>
    fn({
      vehicleRepo,
      maintenanceLogRepo,
      bookingRepo,
      bookingEventRepo,
      locationRepo,
      insuranceOptionRepo,
      addOnRepo,
      feeScheduleRepo,
      userRepo,
    })
  const runOperatorGrant: RunOperatorGrant = (fn) =>
    fn({ memberships: operatorMembershipRepo, users: userRepo, invites: providerInviteRepo })
  return {
    vehicleClassRepo: new InMemoryVehicleClassRepository(),
    vehicleRepo,
    bookingRepo,
    availabilityRepo,
    userRepo,
    fleetOverviewRepo: new InMemoryFleetOverviewRepository(
      vehicleRepo,
      bookingRepo,
      new Map(),
      maintenanceLogRepo,
    ),
    vehicleDetailRepo: new InMemoryVehicleDetailRepository(
      vehicleRepo,
      bookingRepo,
      new Map(),
      maintenanceLogRepo,
    ),
    statsRepo: new InMemoryStatsRepository(vehicleRepo, bookingRepo),
    overviewRepo: new InMemoryOverviewRepository(vehicleRepo, bookingRepo),
    threadRepo,
    messageRepo: new InMemoryMessageRepository(threadRepo),
    maintenanceLogRepo,
    photoStorage: new InMemoryPhotoStorage(),
    renterDocumentRepo: new InMemoryRenterDocumentRepository(),
    documentStorage: new InMemoryDocumentStorage(),
    customerRepo: new InMemoryCustomerRepository(new Map(), new Map()),
    operatorRepo,
    locationRepo,
    insuranceOptionRepo,
    addOnRepo,
    feeScheduleRepo,
    notificationLogRepo: new InMemoryNotificationLogRepository(),
    complianceAlertLogRepo: new InMemoryComplianceAlertLogRepository(),
    storefrontRepo: new InMemoryStorefrontRepository(locationRepo, operatorRepo),
    regionRepo: new InMemoryRegionRepository(),
    paymentEventRepo: new InMemoryPaymentEventRepository(),
    paymentRefundRepo: new InMemoryPaymentRefundRepository(refundStore),
    refundReconcilerRepo: new InMemoryRefundReconcilerRepository(bookingStore, refundStore),
    paymentAnomalyRepo: new InMemoryPaymentAnomalyRepository(),
    providerInviteRepo,
    operatorMembershipRepo,
    auditLogRepo,
    bookingEventRepo,
    runInTransaction,
    runOperatorGrant,
    photosPublicUrl: process.env.VEHICLE_PHOTOS_PUBLIC_URL ?? '',
    googleAuthRuntime: undefined,
  }
}

/**
 * Composition-root entry point: selects the right wiring by the same precedence
 * `createApp` used inline — explicit overrides (tests) win, else Drizzle when a
 * DATABASE_URL is present (production), else in-memory (local dev).
 */
export function buildRepos(overrides?: AppOverrides): Repos {
  if (overrides) return buildOverrideRepos(overrides)
  if (process.env.DATABASE_URL) return buildDrizzleRepos()
  return buildInMemoryRepos()
}
