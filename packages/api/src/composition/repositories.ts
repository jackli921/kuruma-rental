import { type RunTx, getDb, runTx } from '@kuruma/shared/db'
import type { AppOverrides } from '../app-overrides'
import { DrizzleOAuthAccountStore } from '../auth/drizzle-oauth-account-store'
import { FetchGoogleOAuthProvider } from '../auth/fetch-google-oauth-provider'
import type { GoogleAuthRuntime } from '../auth/google'
import { DisabledDocumentStorage } from '../repositories/disabled-document-storage'
import { DisabledPhotoStorage } from '../repositories/disabled-photo-storage'
import {
  type Db,
  DrizzleAddOnRepository,
  DrizzleAvailabilityRepository,
  DrizzleBookingEventRepository,
  DrizzleBookingRepository,
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
  DrizzleProviderInviteRepository,
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
  InMemoryOperatorMembershipRepository,
  InMemoryOperatorRepository,
  InMemoryOverviewRepository,
  InMemoryPaymentAnomalyRepository,
  InMemoryPaymentEventRepository,
  InMemoryProviderInviteRepository,
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
  AvailabilityRepository,
  BookingEventRepository,
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
  OperatorMembershipRepository,
  OperatorRepository,
  OverviewRepository,
  PaymentAnomalyRepository,
  PaymentEventRepository,
  PhotoStorage,
  ProviderInviteRepository,
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
  storefrontRepo: StorefrontRepository
  regionRepo: RegionRepository
  paymentEventRepo: PaymentEventRepository
  paymentAnomalyRepo: PaymentAnomalyRepository
  providerInviteRepo: ProviderInviteRepository
  operatorMembershipRepo: OperatorMembershipRepository
  bookingEventRepo: BookingEventRepository
  runInTransaction: RunInTransaction
  runOperatorGrant: RunOperatorGrant
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
  const storefrontRepo =
    overrides.storefrontRepo ?? new InMemoryStorefrontRepository(locationRepo, operatorRepo)
  const regionRepo = overrides.regionRepo ?? new InMemoryRegionRepository()
  const paymentEventRepo = overrides.paymentEventRepo ?? new InMemoryPaymentEventRepository()
  const paymentAnomalyRepo = overrides.paymentAnomalyRepo ?? new InMemoryPaymentAnomalyRepository()
  const providerInviteRepo = overrides.providerInviteRepo ?? new InMemoryProviderInviteRepository()
  const operatorMembershipRepo =
    overrides.operatorMembershipRepo ?? new InMemoryOperatorMembershipRepository()
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
    storefrontRepo,
    regionRepo,
    paymentEventRepo,
    paymentAnomalyRepo,
    providerInviteRepo,
    operatorMembershipRepo,
    bookingEventRepo,
    runInTransaction,
    runOperatorGrant,
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
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const bookingRepo = new DrizzleBookingRepository(db)
  const userRepo = new DrizzleUserRepository(db)
  const operatorRepo = new DrizzleOperatorRepository(db)
  const operatorMembershipRepo = new DrizzleOperatorMembershipRepository(db)
  const providerInviteRepo = new DrizzleProviderInviteRepository(db)
  // Real Google OAuth runtime: HTTP provider + Drizzle-backed account store.
  // Built only here (the composition root) so the route stays adapter-agnostic.
  const googleAuthRuntime: GoogleAuthRuntime = {
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
    vehicleClassRepo: new DrizzleVehicleClassRepository(db),
    vehicleRepo,
    bookingRepo,
    availabilityRepo: new DrizzleAvailabilityRepository(db),
    userRepo,
    fleetOverviewRepo: new DrizzleFleetOverviewRepository(db),
    vehicleDetailRepo: new DrizzleVehicleDetailRepository(db),
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
    storefrontRepo: new DrizzleStorefrontRepository(db),
    regionRepo: new DrizzleRegionRepository(db),
    paymentEventRepo: new DrizzlePaymentEventRepository(db),
    paymentAnomalyRepo: new DrizzlePaymentAnomalyRepository(db),
    providerInviteRepo,
    operatorMembershipRepo,
    bookingEventRepo: new DrizzleBookingEventRepository(db),
    runInTransaction: createDrizzleTransaction(tx),
    // Real interactive tx (#493): membership INSERT first so the partial-unique-
    // active index aborts the whole grant on a concurrent double-accept.
    runOperatorGrant: createDrizzleOperatorGrant(tx),
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
  const bookingRepo = new InMemoryBookingRepository()
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
    storefrontRepo: new InMemoryStorefrontRepository(locationRepo, operatorRepo),
    regionRepo: new InMemoryRegionRepository(),
    paymentEventRepo: new InMemoryPaymentEventRepository(),
    paymentAnomalyRepo: new InMemoryPaymentAnomalyRepository(),
    providerInviteRepo,
    operatorMembershipRepo,
    bookingEventRepo,
    runInTransaction,
    runOperatorGrant,
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
