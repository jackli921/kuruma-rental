export type {
  Vehicle,
  VehicleClass,
  Booking,
  BookingEvent,
  User,
  Thread,
  ThreadParticipant,
  Message,
  MaintenanceLog,
  NotificationLog,
  Operator,
  Location,
  InsuranceOption,
  AddOn,
  FeeSchedule,
  PaymentEvent,
  RenterDocument,
} from '../stores'
export type { DashboardStats } from '@kuruma/shared/types/stats'
export type { OperatorOverview } from '@kuruma/shared/types/overview'
export type { FleetVehicleOverview, FleetBookingSummary } from '@kuruma/shared/types/fleet'
export type { VehicleDetail } from '@kuruma/shared/types/vehicle-detail'
export type { Customer, CustomerSort, CustomerWithBookings } from '@kuruma/shared/types/customer'

import type { CoordinateSource } from '@kuruma/shared/db/schema'
import type { Customer, CustomerSort, CustomerWithBookings } from '@kuruma/shared/types/customer'
import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { OperatorOverview } from '@kuruma/shared/types/overview'
import type { DashboardStats } from '@kuruma/shared/types/stats'
import type { VehicleDetail } from '@kuruma/shared/types/vehicle-detail'
import type { OperatorRole } from '@kuruma/shared/validators/provider-invite'
import type { CallerContext } from '../middleware/auth'
import type {
  AddOn,
  Booking,
  BookingEvent,
  FeeSchedule,
  InsuranceOption,
  Location,
  MaintenanceLog,
  Message,
  NotificationLog,
  Operator,
  OperatorMembership,
  PaymentEvent,
  ProviderInvite,
  RenterDocument,
  Thread,
  ThreadParticipant,
  User,
  Vehicle,
  VehicleClass,
} from '../stores'

/** A verified successful payment to persist. id + createdAt are assigned by the
 *  store (DB defaults / in-memory), so the service never invents them (#461). */
export type NewPaymentEvent = Omit<PaymentEvent, 'id' | 'createdAt'>

/** payment_events data access (#461). The webhook is the only writer. */
export interface PaymentEventRepository {
  // Persist a verified successful payment. Throws a PG-shaped UNIQUE_VIOLATION
  // (with `constraint_name`) when any of the three seals is hit, so the
  // PaymentService can tell a redelivered webhook (idempotent no-op) apart from
  // a second Session paying the same booking (double-pay anomaly). See pg-errors.
  insert(event: NewPaymentEvent): Promise<PaymentEvent>
  // The recorded SUCCEEDED payment for a booking, or null. Powers both the
  // already-paid guard at checkout and the derived "is this booking paid?" read.
  findSucceededByBookingId(bookingId: string): Promise<PaymentEvent | null>
  // Every SUCCEEDED payment across all operators, for the platform-admin revenue
  // report (#462). Unscoped by design — authz lives in AdminRevenueService.
  listSucceeded(): Promise<PaymentEvent[]>
}

/** Operator (tenant) data access. Admin bootstrap (#386) + slug/id resolution (#387). */
export interface OperatorRepository {
  create(data: {
    name: string
    slug: string
    preAuthHandoffUrl: string | null
  }): Promise<Operator>
  existsBySlug(slug: string): Promise<boolean>
  // Slice 2 (#387): the business layout resolves the /manage/<slug> URL segment
  // and the sidebar resolves the caller's own slug. Access is decided in
  // OperatorService (operator may only read its own); the repo is unscoped.
  findById(id: string): Promise<Operator | undefined>
  // #407: list all operators (name-sorted), powering the admin operator picker.
  // Caller scoping (operator sees only its own) is applied in OperatorService.
  list(): Promise<Operator[]>
  findBySlug(slug: string): Promise<Operator | undefined>
}

export interface LocationFilters {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
  /**
   * Explicit tenant filter. ONLY the PLATFORM_ADMIN route layer sets this (from
   * `?operatorId=`); it narrows a bypass-role read to one tenant. It is IGNORED
   * for operator callers — their scope is absolute (see findAll precedence).
   */
  operatorId?: string
}

export interface LocationRepository {
  findAll(ctx: CallerContext, filters?: LocationFilters): Promise<Location[]>
  findById(ctx: CallerContext, id: string): Promise<Location | undefined>
  /**
   * Operator-keyed lookup for the service-level name-uniqueness pre-check. NOT
   * ctx-scoped — the caller passes an already-resolved operatorId (the DB
   * `(operatorId, name)` unique constraint is the real seal).
   */
  findByOperatorAndName(operatorId: string, name: string): Promise<Location | undefined>
  // lat/lng + coordinateSource (#531) and regionId (#394) are optional on create
  // (default null). The service derives coords via the Geocoder; callers with a
  // MANUAL pin pass them. The location form does not capture a region yet. All
  // four DB columns are nullable.
  create(
    data: Omit<
      Location,
      'id' | 'createdAt' | 'updatedAt' | 'latitude' | 'longitude' | 'coordinateSource' | 'regionId'
    > & {
      latitude?: number | null
      longitude?: number | null
      coordinateSource?: CoordinateSource | null
      regionId?: string | null
    },
  ): Promise<Location>
  update(id: string, data: Partial<Location>): Promise<Location | undefined>
  archive(id: string): Promise<Location | undefined>
}

export interface InsuranceOptionFilters {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
  /**
   * Explicit tenant filter. ONLY the bypass-role route layer sets this (from
   * `?operatorId=`); it narrows a bypass-role read to one tenant. It is IGNORED
   * for operator callers — their scope is absolute (see findAll precedence).
   */
  operatorId?: string
}

export interface InsuranceOptionRepository {
  // Reads call requireManagementRead(ctx) (rejects RENTER + PARTNER) BEFORE
  // operatorReadScope(ctx): insurance is operator-private, not a public catalog
  // (slice-4 plan §2 [P0]).
  findAll(ctx: CallerContext, filters?: InsuranceOptionFilters): Promise<InsuranceOption[]>
  findById(ctx: CallerContext, id: string): Promise<InsuranceOption | undefined>
  /**
   * Operator-keyed lookup for the service-level name-uniqueness pre-check,
   * filtered to status='ACTIVE' to match the partial active-name unique index
   * (archiving frees the name). NOT ctx-scoped — the caller passes an
   * already-resolved operatorId; the DB partial index is the real seal.
   */
  findActiveByOperatorAndName(
    operatorId: string,
    name: string,
  ): Promise<InsuranceOption | undefined>
  /**
   * ACTIVE options for one operator, name-sorted. NOT ctx-scoped — the caller
   * passes an already-resolved operatorId. Powers the PUBLIC storefront read
   * (#392): a renter booking at a storefront must see its operator's active
   * coverage, so this deliberately bypasses the management-only `findAll` seal.
   * Scope is single-operator + ACTIVE-only, never a cross-operator enumeration.
   */
  findActiveByOperator(operatorId: string): Promise<InsuranceOption[]>
  create(data: Omit<InsuranceOption, 'id' | 'createdAt' | 'updatedAt'>): Promise<InsuranceOption>
  update(id: string, data: Partial<InsuranceOption>): Promise<InsuranceOption | undefined>
  archive(id: string): Promise<InsuranceOption | undefined>
}

export interface AddOnFilters {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
  /**
   * Explicit tenant filter. ONLY the bypass-role route layer sets this (from
   * `?operatorId=`); it narrows a bypass-role read to one tenant. It is IGNORED
   * for operator callers — their scope is absolute (see findAll precedence).
   */
  operatorId?: string
}

export interface AddOnRepository {
  // Reads call requireManagementRead(ctx) (rejects RENTER + PARTNER) BEFORE
  // operatorReadScope(ctx): add-ons are operator-private, not a public catalog
  // (#460, mirrors insurance options).
  findAll(ctx: CallerContext, filters?: AddOnFilters): Promise<AddOn[]>
  findById(ctx: CallerContext, id: string): Promise<AddOn | undefined>
  /**
   * Operator-keyed lookup for the service-level name-uniqueness pre-check,
   * filtered to status='ACTIVE' to match the partial active-name unique index
   * (archiving frees the name). NOT ctx-scoped — the caller passes an
   * already-resolved operatorId; the DB partial index is the real seal.
   */
  findActiveByOperatorAndName(operatorId: string, name: string): Promise<AddOn | undefined>
  /**
   * ACTIVE add-ons for one operator, name-sorted. NOT ctx-scoped — the caller
   * passes an already-resolved operatorId. Powers the PUBLIC storefront read
   * (#460): a renter booking at a storefront must see its operator's active
   * add-ons, so this deliberately bypasses the management-only `findAll` seal.
   * Scope is single-operator + ACTIVE-only, never a cross-operator enumeration.
   */
  findActiveByOperator(operatorId: string): Promise<AddOn[]>
  create(data: Omit<AddOn, 'id' | 'createdAt' | 'updatedAt'>): Promise<AddOn>
  update(id: string, data: Partial<AddOn>): Promise<AddOn | undefined>
  archive(id: string): Promise<AddOn | undefined>
}

// #521 provider authorization. Not ctx-scoped: the admin endpoint
// (PLATFORM_ADMIN-gated) and the OAuth callback pass already-resolved values;
// the DB unique/partial indexes are the real seals.
export interface ProviderInviteRepository {
  create(data: Omit<ProviderInvite, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderInvite>
  /** Single-row lookup by sha256(token) — the unique tokenHash index. */
  findByTokenHash(tokenHash: string): Promise<ProviderInvite | undefined>
  /** Consume the invite at acceptance: PENDING -> ACCEPTED + stamp the redeemer.
   *  One of the three writes in the grant transaction (#521 §6). */
  markAccepted(id: string, acceptedByUserId: string): Promise<void>
}

// #521. `findActiveByUserId` is served by the partial-unique-active index
// (query filters status='ACTIVE'). `create` is fenced by that same index.
export interface OperatorMembershipRepository {
  findActiveByUserId(userId: string): Promise<OperatorMembership | undefined>
  create(
    data: Omit<OperatorMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<OperatorMembership>
}

export interface VehicleFilters {
  status?: string
  includeRetired?: boolean
  classId?: string
  limit?: number
  offset?: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
}

export interface VehicleUpdateOptions {
  expectedStatus?: Vehicle['status']
}

/**
 * Issue #329: CallerContext is threaded through every method as defence
 * in depth. Mutations reject non-STAFF callers at the repo layer so a
 * forgotten route-level `STAFF_ROLES` check cannot silently escalate
 * privilege. Reads stay unrestricted so the public renter catalog can
 * pass `SYSTEM_CONTEXT` for aggregate queries.
 */
export interface VehicleRepository {
  findAll(ctx: CallerContext, filters?: VehicleFilters): Promise<PaginatedResult<Vehicle>>
  findById(ctx: CallerContext, id: string): Promise<Vehicle | undefined>
  findByIds(ctx: CallerContext, ids: string[]): Promise<Vehicle[]>
  create(
    ctx: CallerContext,
    data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Vehicle>
  update(
    ctx: CallerContext,
    id: string,
    data: Partial<Vehicle>,
    options?: VehicleUpdateOptions,
  ): Promise<Vehicle | undefined>
  softDelete(ctx: CallerContext, id: string): Promise<Vehicle | undefined>
  bulkUpdateStatus(
    ctx: CallerContext,
    ids: string[],
    status: 'AVAILABLE' | 'MAINTENANCE',
  ): Promise<Vehicle[]>
  // Atomic photo-array ops. Single SQL statements so concurrent callers
  // cannot race a read-modify-write on the photos array.
  appendPhotos(
    ctx: CallerContext,
    id: string,
    urls: string[],
    maxPhotos: number,
  ): Promise<
    { outcome: 'ok'; vehicle: Vehicle } | { outcome: 'cap_exceeded' } | { outcome: 'not_found' }
  >
  removePhotoByUrl(ctx: CallerContext, id: string, url: string): Promise<Vehicle | undefined>
}

// Aggregated read for the owner-facing /manage/vehicles list. Enriches
// each vehicle with utilization %, booking count, and current/next
// booking state. Computed per-request — NOT denormalized into the
// vehicles table. See issue #52 and @kuruma/shared/types/fleet.
//
// Split from VehicleRepository because it reads across multiple tables
// (vehicles + bookings + users.name) — following the same boundary as
// AvailabilityRepository, which also reads vehicles + bookings.
export interface FleetOverviewRepository {
  // `now` is injected so time-based cutoffs (utilization window,
  // current/upcoming filtering) live in callers, not infrastructure.
  // Tests can pass a fixed Date without faking the global clock.
  //
  // `ctx` carries the caller's tenant scope (#594): OPERATOR_* see only their
  // own vehicles; bypass roles (PLATFORM_ADMIN / legacy STAFF/ADMIN) see all.
  // The route gates out RENTER/PARTNER before this is reached.
  findFleetOverview(ctx: CallerContext, now: Date): Promise<FleetVehicleOverview[]>
}

/**
 * #396: UserRepository is intentionally NOT operator-scoped — it takes no
 * CallerContext. This stays safe because every ingress already blocks
 * OPERATOR_* callers from reaching it: /customers is STAFF-gated, /users
 * resolves OPERATOR_* callers to self-only (they are excluded from the
 * thread-participant name resolution that renters get), and the booking paths
 * fail-close at BookingRepository before any user lookup (regression-locked in
 * tests/routes/operator-user-isolation.test.ts). Renters are shared
 * marketplace customers (users.operatorId is nullable), so filtering users by
 * operatorId would hide the very customers operators will later need to see.
 * Real per-operator scoping is deferred to slice 6 (operator customer access).
 */
export interface UserRepository {
  findByIds(ids: string[]): Promise<User[]>
  search(query: string): Promise<User[]>
  quickCreate(data: {
    name: string
    email: string | null
    phone: string | null
    language: string
  }): Promise<User>
  findByEmail(email: string): Promise<User | undefined>
  findByPhone(phone: string): Promise<User | undefined>
  // Slice 7 (#393): the operator's OPERATOR_OWNER contact users, for the booking
  // alert recipient. A fixed-purpose PLATFORM-INTERNAL read over the indexed
  // users.operatorId — NOT a caller-facing lookup, so it does NOT reopen the #396
  // renter-enumeration vector. Owner-only by design (no OPERATOR_STAFF in MVP).
  findOperatorContacts(operatorId: string): Promise<User[]>
  // #521 Decision 1: project an accepted operator grant onto users.role +
  // users.operatorId — the single-active denormalisation the JWT reads. One of
  // the three writes in the grant transaction; the OperatorRole subset is exactly
  // the DB role-enum members it sets, so no widening cast is needed.
  setOperatorAccess(
    userId: string,
    access: { role: OperatorRole; operatorId: string },
  ): Promise<void>
}

/**
 * Slice 7 (#393): how long a SENDING lease is honoured before another sender may
 * reclaim the row (§3). A crash mid-send leaves a SENDING row that is reclaimable
 * ONLY after this window — a live lease is never reclaimed (else double-send).
 */
export const SEND_LEASE_MS = 5 * 60 * 1000

/**
 * #483: after this many delivery attempts a notification is marked terminal DEAD
 * instead of FAILED. The claim predicate reclaims QUEUED / FAILED / expired
 * SENDING but NEVER DEAD — so a permanently-bad recipient (hard bounce, malformed
 * address) stops being re-sent on every booking replay and operator resend. The
 * cap counts the attempt being recorded: markFailed sees the already-incremented
 * `attempts` (claim bumped it) and flips to DEAD when `attempts >= cap`.
 */
export const MAX_NOTIFICATION_ATTEMPTS = 5

export interface NotificationLogUpsert {
  bookingId: string
  operatorId: string
  kind: NotificationLog['kind']
  recipient: string
  locale: string
  idempotencyKey: string
}

export interface NotificationLogFilters {
  bookingId?: string
  operatorId?: string
}

export interface NotificationLogRepository {
  // Insert a QUEUED row keyed by idempotencyKey. If a row already exists (a
  // post-commit replay), return it UNCHANGED — the unique key seals one row per
  // (booking, kind), so a replay never creates a duplicate to double-send.
  upsertQueued(data: NotificationLogUpsert): Promise<NotificationLog>
  // Atomic lease claim (§3): flips QUEUED / FAILED / an EXPIRED SENDING to
  // SENDING and bumps attempts, returning the row. Returns undefined when a LIVE
  // SENDING lease holds it — the concurrent-send guard. Unscoped (keyed by id;
  // the resend route scopes via findById first).
  claim(id: string): Promise<NotificationLog | undefined>
  markSent(id: string, providerMessageId: string): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  // Operator-portal list (management-read guarded, operator-scoped).
  findAll(ctx: CallerContext, filters?: NotificationLogFilters): Promise<NotificationLog[]>
  // Scoped single read (resend route: cross-operator id -> undefined -> 404).
  findById(ctx: CallerContext, id: string): Promise<NotificationLog | undefined>
}

export interface CustomerListFilters {
  search?: string | undefined
  sort?: CustomerSort | undefined
  limit?: number | undefined
  cursor?: string | undefined
}

export interface CustomerRepository {
  findAllWithAggregates(filters: CustomerListFilters): Promise<Customer[]>
  findByIdWithBookings(id: string): Promise<CustomerWithBookings | undefined>
}

export interface BookingFilters {
  status?: string
  vehicleId?: string
  renterId?: string
  from?: Date
  to?: Date
  limit?: number
  cursor?: string
}

export type { CallerContext } from '../middleware/auth'

export interface BookingRepository {
  findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]>
  findById(ctx: CallerContext, id: string): Promise<Booking | undefined>
  findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Booking | undefined>
  /** Counts bookings in BLOCKING_STATUSES (CONFIRMED, ACTIVE) for the given
   *  vehicle set. Used to guard operations that assume no live bookings exist
   *  for those vehicles — e.g. archiving a vehicle class. */
  countActiveForVehicles(vehicleIds: string[]): Promise<number>
  /** Counts bookings in BLOCKING_STATUSES (CONFIRMED, ACTIVE) that reference the
   *  given location as pickup OR dropoff. Guards archiving a location still in
   *  live use (#412). */
  countActiveForLocation(locationId: string): Promise<number>
  create(
    ctx: CallerContext,
    data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Booking>
  updateStatus(
    ctx: CallerContext,
    id: string,
    transition: { from: Booking['status']; to: Booking['status'] },
  ): Promise<Booking | undefined>
  cancel(
    ctx: CallerContext,
    id: string,
    opts: { from: Booking['status']; fee: number; cancelledAt: Date },
  ): Promise<Booking | undefined>
  /**
   * Operator vehicle substitution (#392, §5.5): atomically reassign a booking to
   * a new vehicle. Re-checks the exclusion constraint for the NEW assigned
   * vehicle over the booking's [startAt, effectiveEndAt) — throws
   * EXCLUSION_VIOLATION (23P01) if that car is already booked for the range —
   * and re-snapshots totalPrice/effectiveEndAt. Returns undefined when the
   * booking is not visible to the caller. requestedVehicleId is never touched.
   */
  reassignVehicle(
    ctx: CallerContext,
    id: string,
    data: { assignedVehicleId: string; totalPrice: number | null; effectiveEndAt: Date },
  ): Promise<Booking | undefined>
}

/**
 * Append-only booking lifecycle log (#392, proposal §5.2). The events are the
 * source of truth; `bookings.status` is the write-through projection. There is
 * deliberately NO update/delete method — immutability is enforced by the
 * interface, not just convention.
 */
export interface BookingEventRepository {
  append(ctx: CallerContext, event: Omit<BookingEvent, 'id' | 'createdAt'>): Promise<BookingEvent>
  findByBookingId(ctx: CallerContext, bookingId: string): Promise<BookingEvent[]>
}

export interface StatsRepository {
  getDashboardStats(): Promise<DashboardStats>
}

/**
 * Operator-scoped dashboard counts (#524). `ctx` decides the tenant scope via
 * {@link bookingReadScope}: bypass roles aggregate across all operators, an
 * OPERATOR_* caller sees only its own tenant, and an operator missing its
 * operatorId fails closed to zeros (mirrors how its own bookings list behaves).
 * `now` is injected so "upcoming" is deterministic in tests.
 */
export interface OverviewRepository {
  getOperatorOverview(ctx: CallerContext, now: Date): Promise<OperatorOverview>
}

/**
 * Optional scoping for {@link AvailabilityRepository.findAvailableVehicles}.
 * Storefront search (#391) needs availability scoped to one location/class;
 * every field defaults to "no filter" so existing callers are unaffected.
 */
export interface AvailabilityFilters {
  locationId?: string
  operatorId?: string
  classId?: string
}

export interface AvailabilityRepository {
  findAvailableVehicles(from: Date, to: Date, filters?: AvailabilityFilters): Promise<Vehicle[]>
  checkVehicleAvailability(
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<
    | {
        available: boolean
        vehicle: Vehicle
        conflicts: Booking[]
      }
    | undefined
  >
}

/**
 * A location surfaced as a public storefront card (#391): the owning operator's
 * display `name` joined in for the renter. The availability counts and
 * from-prices are layered on later by StorefrontSearchService — this is just the
 * location row plus the operator name.
 */
export type Storefront = Location & { operatorName: string }

export interface StorefrontFilters {
  /** Narrow to a single storefront — the degenerate single-card search. */
  pickupLocationId?: string
}

/**
 * Public renter-facing catalog read (#391). Distinct from LocationRepository,
 * which is operator-private management CRUD: this returns ACTIVE storefronts
 * across ALL operators for the anonymous renter (operatorReadScope resolves
 * PUBLIC_CONTEXT to {kind:'all'}). Cross-tenant is intentional — the safety
 * control on this public multi-tenant read is column projection, not row
 * scoping (slice-5 plan §5). Archived locations never surface.
 */
export interface StorefrontRepository {
  findActiveStorefronts(ctx: CallerContext, filters?: StorefrontFilters): Promise<Storefront[]>
}

// Enriched read for the owner-facing /manage/vehicles/[id] detail page.
// Returns a single vehicle with upcoming bookings, revenue, and utilization.
// See issue #53.
export interface VehicleDetailRepository {
  // `now` injected for the same reason as FleetOverviewRepository:
  // revenue window, upcoming-booking filtering, and utilization range
  // are business decisions owned by the service layer.
  // `ctx` is the tenant boundary: an OPERATOR_* caller only resolves a vehicle
  // in its own tenant (operatorReadScope), so a foreign id returns undefined.
  findVehicleDetail(
    ctx: CallerContext,
    vehicleId: string,
    now: Date,
  ): Promise<VehicleDetail | undefined>
}

export interface ThreadRepository {
  findAll(
    ctx: CallerContext,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>>
  findById(
    ctx: CallerContext,
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined>
  /**
   * Look up a thread by idempotency key scoped to the caller. Non-privileged
   * callers only match threads where they are a participant. Prevents
   * cross-tenant leakage when a client replays a key observed from another
   * tenant (issue #328).
   */
  findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Thread | undefined>
  create(
    ctx: CallerContext,
    bookingId: string | null,
    participantIds: string[],
    idempotencyKey?: string | null,
  ): Promise<Thread>
  markAsRead(ctx: CallerContext, threadId: string): Promise<void>
}

export interface MessageRepository {
  /**
   * Find a message by id, scoped to the caller. Non-privileged callers
   * only see messages in threads they participate in; others get
   * `undefined`. Privileged roles (STAFF/ADMIN) bypass the scope.
   */
  findById(ctx: CallerContext, id: string): Promise<Message | undefined>
  /**
   * Look up a message by idempotency key scoped to the caller. The key is
   * sender-owned: the lookup matches only messages where `senderId = ctx.userId`
   * for non-privileged callers. Prevents cross-tenant leakage when a client
   * replays a key observed from another sender (issue #328).
   */
  findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Message | undefined>
  create(
    ctx: CallerContext,
    threadId: string,
    content: string,
    idempotencyKey?: string | null,
  ): Promise<Message>
  findByThreadId(ctx: CallerContext, threadId: string): Promise<Message[]>
  /**
   * Merge a single language translation into the message's `translations`
   * JSON map. If `detectedSourceLanguage` is provided, also update the
   * message's `sourceLanguage` column (used when the original language
   * was unknown at send time and the provider auto-detected it).
   */
  updateTranslation(
    messageId: string,
    language: string,
    translatedText: string,
    detectedSourceLanguage: string | null,
  ): Promise<Message | undefined>
}

// Transaction boundary for operations spanning multiple repositories.
// Drizzle: wraps db.transaction(), creating repos bound to the tx handle.
// InMemory: passes repos through (JS event loop is single-threaded).
//
// Slice 6 (#392) widens the bundle so the single-transaction booking submit
// (proposal §4) can — atomically — validate availability (booking insert ->
// exclusion constraint), append the BOOKING_CREATED event, and read the
// vehicle / location / insurance / fee rows for the price + snapshots at a
// consistent point-in-time. MaintenanceService still uses only the first two.
export interface TransactionRepos {
  vehicleRepo: VehicleRepository
  maintenanceLogRepo: MaintenanceLogRepository
  bookingRepo: BookingRepository
  bookingEventRepo: BookingEventRepository
  locationRepo: LocationRepository
  insuranceOptionRepo: InsuranceOptionRepository
  addOnRepo: AddOnRepository
  feeScheduleRepo: FeeScheduleRepository
}

export type RunInTransaction = <T>(fn: (repos: TransactionRepos) => Promise<T>) => Promise<T>

// #521 §6: the minimal write surface the atomic operator-grant transaction needs —
// the membership ledger INSERT, the denormalised users projection, and invite
// consumption. Run together in ONE tx so a mid-sequence failure can't leave a partial
// grant (membership without projection, or invite consumed without a membership row).
// The membership INSERT goes first so the partial-unique-active index aborts the WHOLE
// tx on a concurrent double-accept; the service then re-reads the winner.
export interface OperatorGrantRepos {
  memberships: Pick<OperatorMembershipRepository, 'create'>
  users: Pick<UserRepository, 'setOperatorAccess'>
  invites: Pick<ProviderInviteRepository, 'markAccepted'>
}

// Drizzle wires the real per-call neon-serverless tx (#493, pooled DATABASE_URL);
// InMemory passes the plain repos (single-threaded, no real tx). Mirrors
// RunInTransaction (the booking bundle) but scoped to the grant's three tables.
export type RunOperatorGrant = <T>(fn: (repos: OperatorGrantRepos) => Promise<T>) => Promise<T>

export interface TransitionLogsResult {
  resolved?: MaintenanceLog
  created?: MaintenanceLog
}

export interface MaintenanceLogRepository {
  findByVehicleId(vehicleId: string): Promise<MaintenanceLog[]>
  findActiveByVehicleId(vehicleId: string): Promise<MaintenanceLog | undefined>
  create(data: Omit<MaintenanceLog, 'id' | 'createdAt' | 'updatedAt'>): Promise<MaintenanceLog>
  resolve(id: string, resolvedAt: Date): Promise<MaintenanceLog | undefined>
  transitionLogs(
    vehicleId: string,
    resolvedAt: Date,
    newLogData?: Omit<MaintenanceLog, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<TransitionLogsResult>
}

export interface VehicleClassFilters {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
}

export interface VehicleClassRepository {
  findAll(ctx: CallerContext, filters?: VehicleClassFilters): Promise<VehicleClass[]>
  findById(ctx: CallerContext, id: string): Promise<VehicleClass | undefined>
  findBySlug(ctx: CallerContext, slug: string): Promise<VehicleClass | undefined>
  create(data: Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>): Promise<VehicleClass>
  update(id: string, data: Partial<VehicleClass>): Promise<VehicleClass | undefined>
  archive(id: string): Promise<VehicleClass | undefined>
}

export interface FeeScheduleFilters {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
  /**
   * Explicit tenant filter. ONLY the bypass route layer sets this (from
   * `?operatorId=`); it narrows a bypass-role read to one tenant. IGNORED for
   * operator callers — their scope is absolute (see findAll precedence).
   */
  operatorId?: string
  feeType?: 'OVERTIME_HOURLY' | 'CLEANING_FLAT' | 'NO_FUEL_FLAT'
  /** Narrow to one vehicle class. The string 'null' / explicit null is not a
   *  filter value here — operator-wide rows surface in an unfiltered list. */
  vehicleClassId?: string
}

export interface FeeScheduleRepository {
  findAll(ctx: CallerContext, filters?: FeeScheduleFilters): Promise<FeeSchedule[]>
  findById(ctx: CallerContext, id: string): Promise<FeeSchedule | undefined>
  /**
   * Active-uniqueness pre-check lookup for the service. NOT ctx-scoped — the
   * caller passes an already-resolved operatorId. Returns the ACTIVE row (if
   * any) matching (operatorId, feeType, scope) where scope is the per-class id
   * or `null` (operator-wide). The DB partial unique indexes are the real seal.
   */
  findActiveByScope(
    operatorId: string,
    feeType: FeeSchedule['feeType'],
    vehicleClassId: string | null,
  ): Promise<FeeSchedule | undefined>
  create(data: Omit<FeeSchedule, 'id' | 'createdAt' | 'updatedAt'>): Promise<FeeSchedule>
  update(id: string, data: Partial<FeeSchedule>): Promise<FeeSchedule | undefined>
  archive(id: string): Promise<FeeSchedule | undefined>
}

export interface PhotoStorage {
  put(vehicleId: string, file: File): Promise<{ key: string; url: string }>
  /** Accepts either a key or full URL — implementations strip the base URL prefix. */
  delete(keyOrUrl: string): Promise<void>
}

export interface RenterDocumentFilters {
  limit?: number
  offset?: number
}

/**
 * The verdict a verifier records (#459). `verifierId` is the reviewing staff
 * user; the repo stamps `verifiedAt` itself. APPROVED carries `expiryDate`,
 * REJECTED carries `rejectionReason` — coherence is enforced upstream by
 * `verifyDocumentSchema` + the service.
 */
export interface DocumentVerifyInput {
  status: 'APPROVED' | 'REJECTED'
  verifierId: string
  expiryDate?: string | null
  rejectionReason?: string | null
}

export interface RenterDocumentRepository {
  /** Renter uploads their own document. Non-staff callers may only create for themselves. */
  create(ctx: CallerContext, data: CreateRenterDocumentData): Promise<RenterDocument>
  /** A renter's own documents (gate + list-mine). Staff may read any renter's. */
  findByRenter(ctx: CallerContext, renterId: string): Promise<RenterDocument[]>
  findById(ctx: CallerContext, id: string): Promise<RenterDocument | undefined>
  /** Platform-staff pending-review queue, oldest first, paginated. */
  listPending(
    ctx: CallerContext,
    filters?: RenterDocumentFilters,
  ): Promise<PaginatedResult<RenterDocument>>
  /** Platform-staff records a terminal verdict. */
  verify(
    ctx: CallerContext,
    id: string,
    verdict: DocumentVerifyInput,
  ): Promise<RenterDocument | undefined>
  /**
   * Gate lookup for the verification policy — NOT ctx-scoped (internal). Returns
   * the renter's APPROVED documents of a given type; the service decides
   * eligibility against the rental window (expiry).
   */
  findApprovedByType(renterId: string, type: RenterDocument['type']): Promise<RenterDocument[]>
}

export type CreateRenterDocumentData = Pick<RenterDocument, 'renterId' | 'type' | 'storageKey'>

/**
 * Private object storage for renter document scans (#459). Unlike `PhotoStorage`
 * (public vehicle photos), documents are private — access is via a short-lived
 * signed URL, never a public base URL.
 */
export interface DocumentStorage {
  put(renterId: string, file: File): Promise<{ key: string }>
  /** Short-lived signed URL for a verifier to view the scan. */
  getSignedUrl(key: string): Promise<string>
  delete(key: string): Promise<void>
}
