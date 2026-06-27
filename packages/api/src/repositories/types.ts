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
  Region,
  InsuranceOption,
  AddOn,
  FeeSchedule,
  PaymentEvent,
  RenterDocument,
  VehicleBlock,
  Review,
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
  InsuranceOption,
  Location,
  MaintenanceLog,
  Message,
  Operator,
  OperatorMembership,
  ProviderInvite,
  Region,
  Thread,
  ThreadParticipant,
  User,
  Vehicle,
  VehicleClass,
} from '../stores'
// Imported (not just re-exported) because the RepoBundle below references it locally.
import type { AdminBookingFilters } from './types-admin-booking'
import type { BookingEventRepository } from './types-booking-event'

// Payment interfaces (#461 events, #508 anomalies, #851 refunds) live in their own module (size cap); re-exported.
export type {
  ClaimPaymentRefund,
  NewPaymentAnomaly,
  NewPaymentEvent,
  PaymentAnomalyRepository,
  PaymentEventRepository,
  PaymentRefundRepository,
  RefundReconcilerRepository,
  ResolvePaymentAnomalyInput,
} from './types-payment'

// Notification persistence: SENDING-lease + delivery-cap consts (#393, #483) and
// the notification_log data-access interface (#393) live in their own module to
// keep this barrel under the file-size cap (#837); re-exported for callers.
export { MAX_NOTIFICATION_ATTEMPTS, SEND_LEASE_MS } from './types-notification'
export type {
  NotificationLogFilters,
  NotificationLogNoRecipient,
  NotificationLogRepository,
  NotificationLogUpsert,
} from './types-notification'

// Object-storage ports (PhotoStorage #461/#952, DocumentStorage #459) live in
// their own module to keep this barrel under the file-size cap (#978);
// re-exported for callers.
export type { DocumentStorage, PhotoStorage } from './types-storage'
export type { ClassRatePlanFilters, ClassRatePlanRepository } from './types-pricing'
export { complianceAlertKey } from './types-compliance'
export type { ComplianceAlertLogRepository, RecordComplianceAlert } from './types-compliance'

// Audit ledger entity + insert-only persistence (#930), own module per #837 cap.
export type { AuditLogEntry, AuditLogRepository } from './types-audit'
export type { AdminBookingFilters }
export type { BookingEventRepository }

/** Operator (tenant) data access. Admin bootstrap (#386) + slug/id resolution (#387). */
// Partial profile patch (#903). Only the keys present are written; an absent key
// leaves the column unchanged, `preAuthHandoffUrl: null` clears it. `updatedAt`
// is always supplied by the service (the column has no `$onUpdate`). Caller
// scoping (operator may only patch its own) is decided in OperatorService.
export interface OperatorUpdatePatch {
  name?: string
  preAuthHandoffUrl?: string | null
  // #1088: set to a Date to deactivate, null to reactivate. Absent = unchanged.
  deactivatedAt?: Date | null
  updatedAt: Date
}

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
  // #1087 platform overview: `COUNT(operators)` for the platform-owner home KPI.
  // Unscoped (authz lives in AdminOverviewService). Labelled "Operators" today;
  // TODO(#1088): tighten to active=true once the `deactivatedAt` column lands.
  count(): Promise<number>
  findBySlug(slug: string): Promise<Operator | undefined>
  // #903: apply a partial profile patch and return the updated row, or undefined
  // if no operator has that id (never inserts).
  update(id: string, patch: OperatorUpdatePatch): Promise<Operator | undefined>
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
  // (default null). The service derives lat/lng + coordinateSource via the
  // Geocoder; callers with a MANUAL pin pass coords. All four DB columns nullable.
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
  /** #904: the operator's actionable (PENDING) invites — the self-service team
   *  page. Scoped by operatorId; non-PENDING (accepted/revoked) rows drop off. */
  listByOperator(operatorId: string): Promise<ProviderInvite[]>
  /** #904 slice 2: owner revokes a pending invite. Scoped (operatorId, status='PENDING')
   *  so a tenant can only revoke its own actionable invites; returns the updated row,
   *  or undefined when nothing matched (already accepted/revoked, or another tenant's). */
  revoke(id: string, operatorId: string): Promise<ProviderInvite | undefined>
}

// #521. `findActiveByUserId` is served by the partial-unique-active index
// (query filters status='ACTIVE'). `create` is fenced by that same index.
export interface OperatorMembershipRepository {
  findActiveByUserId(userId: string): Promise<OperatorMembership | undefined>
  // #878: every ACTIVE member (owner + staff) of an operator — the booking-alert
  // recipient set. Ledger-sourced (status='ACTIVE'), so it is revocation-aware and
  // never reads the stale users.role/operatorId projection.
  findActiveByOperator(operatorId: string): Promise<OperatorMembership[]>
  // #1010: batch sibling for the compliance digest — every ACTIVE member of each
  // requested operator, grouped by operatorId in the same (createdAt, id) order, in
  // one query. Operators with no active members are absent from the map.
  findActiveByOperators(operatorIds: string[]): Promise<Map<string, OperatorMembership[]>>
  create(
    data: Omit<OperatorMembership, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<OperatorMembership>
  // #904 slice 2: owner deactivates a member. Scoped (id, operatorId, status=
  // 'ACTIVE'); returns the row, or undefined on no-match (foreign/unknown/revoked).
  deactivate(id: string, operatorId: string): Promise<OperatorMembership | undefined>
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
  // #1087 platform overview: `COUNT(vehicles WHERE status != 'RETIRED')` — the
  // live fleet across all operators. Unscoped (no ctx) by design: this is a
  // platform-wide KPI; authz lives in AdminOverviewService. COUNT at the DB layer,
  // never materialize-then-count.
  countActive(): Promise<number>
  // #1088 admin operator list: live (non-RETIRED) fleet size per operator, for
  // the `fleetCount` column. Returns a Map keyed by operatorId; operators with no
  // live vehicles are absent (caller defaults to 0). Unscoped — authz in the service.
  countByOperator(operatorIds: string[]): Promise<Map<string, number>>
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
  // #589 1c: register a brand-new walk-in/phone customer. ALWAYS inserts a fresh
  // RENTER (random synthetic placeholder email; phone stored as-is) and NEVER
  // dedups by phone/email — distinct from quickCreate's get-or-create. Critical:
  // deduping a walk-in onto an existing user would let an operator attach a
  // booking to (or probe the existence of) another tenant's customer (#396/#475).
  createWalkInRenter(data: { name: string; phone: string }): Promise<User>
  findByEmail(email: string): Promise<User | undefined>
  findByPhone(phone: string): Promise<User | undefined>
  // #521 Decision 1: project an accepted operator grant onto users.role +
  // users.operatorId — the single-active denormalisation the JWT reads. One of
  // the three writes in the grant transaction; the OperatorRole subset is exactly
  // the DB role-enum members it sets, so no widening cast is needed.
  setOperatorAccess(
    userId: string,
    access: { role: OperatorRole; operatorId: string },
  ): Promise<void>
  // #904 slice 2: inverse of setOperatorAccess. Tears the projection back down to a
  // plain RENTER (role + null operatorId) on deactivate; silent no-op if absent.
  clearOperatorAccess(userId: string): Promise<void>
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
  /** #464 Task 7: operator worklist — return only CLASS_COMBO floats that still
   *  need a vehicle assigned (fulfillmentMode='CLASS_COMBO' AND assignedVehicleId
   *  IS NULL AND status IN ('CONFIRMED','ACTIVE')). */
  needsAssignment?: boolean
}

export type { CallerContext } from '../middleware/auth'

export interface BookingRepository {
  findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]>
  /**
   * Cross-operator oversight read (#1092). UNSCOPED — returns bookings across
   * every tenant in (createdAt DESC, id DESC) order. Gate at the service with
   * `requirePlatformAdmin`; never expose to a tenant or PARTNER caller.
   */
  findForAdmin(filters: AdminBookingFilters): Promise<Booking[]>
  findById(ctx: CallerContext, id: string): Promise<Booking | undefined>
  findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Booking | undefined>
  /** #1087 platform overview: `COUNT(bookings)` across every operator for the
   *  platform-owner home KPI. Unscoped by design (authz lives in
   *  AdminOverviewService); COUNT at the DB layer, never load-then-count. */
  count(): Promise<number>
  /** Counts bookings in BLOCKING_STATUSES (CONFIRMED, ACTIVE) for the given
   *  vehicle set. Used to guard operations that assume no live bookings exist
   *  for those vehicles — e.g. archiving a vehicle class. */
  countActiveForVehicles(vehicleIds: string[]): Promise<number>
  /** Counts bookings in BLOCKING_STATUSES (CONFIRMED, ACTIVE) that reference the
   *  given location as pickup OR dropoff. Guards archiving a location still in
   *  live use (#412). */
  countActiveForLocation(locationId: string): Promise<number>
  /** Distinct renter IDs with at least one booking with the given operator.
   *  Powers the #589 operator manual-booking customer picker: an operator may
   *  only resolve renters within its own tenant boundary (a prior booking with
   *  it), never enumerate the global user table (#396/#475). operatorId comes
   *  from the caller's own validated context, never from client input. */
  listRenterIdsForOperator(operatorId: string): Promise<string[]>
  create(
    ctx: CallerContext,
    // cancellationFeeSettlement is server-derived (defaults 'ADVISORY', #868 3a),
    // never a create input — mirrors Location's geocode-field omission above.
    data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'>,
  ): Promise<Booking>
  updateStatus(
    ctx: CallerContext,
    id: string,
    transition: { from: Booking['status']; to: Booking['status'] },
  ): Promise<Booking | undefined>
  cancel(
    ctx: CallerContext,
    id: string,
    // #851: settlement written atomically with status+fee; optional, defaults 'ADVISORY'.
    opts: {
      from: Booking['status']
      fee: number
      cancelledAt: Date
      settlement?: Booking['cancellationFeeSettlement']
    },
  ): Promise<Booking | undefined>
  /** Guarded settlement transition (#851): matches only when the current value is
   *  `from`, so a redelivered webhook / racing reconciler pull gets undefined (0
   *  rows) — atomic, idempotent, never a regression. */
  markCancellationSettlement(
    ctx: CallerContext,
    id: string,
    transition: {
      from: Booking['cancellationFeeSettlement']
      to: Booking['cancellationFeeSettlement']
    },
  ): Promise<Booking | undefined>
  /** Operator vehicle substitution (#392, §5.5): atomically reassign a booking to a
   *  new vehicle. Re-checks the exclusion constraint for the NEW assigned vehicle over
   *  [startAt, effectiveEndAt) — throws EXCLUSION_VIOLATION (23P01) if it's already
   *  booked — and re-snapshots totalPrice/effectiveEndAt. Returns undefined when the
   *  booking is not visible to the caller; requestedVehicleId is never touched. */
  reassignVehicle(
    ctx: CallerContext,
    id: string,
    data: { assignedVehicleId: string; totalPrice: number | null; effectiveEndAt: Date },
  ): Promise<Booking | undefined>
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
 * Every field defaults to "no filter" so existing callers are unaffected (#391).
 */
export interface AvailabilityFilters {
  locationId?: string
  /** #651 §1c: bound the scan to a region's storefront ids; an empty array and a
   * null pickupLocationId both match nothing (the {@link StorefrontFilters} twin). */
  locationIds?: string[]
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
  // #464: total CONFIRMED/ACTIVE class demand overlapping [from, to) at one
  // (operator, location, class) — SPECIFIC occupancy PLUS floating CLASS_COMBO
  // (both via bookings.classId); slice 2's write guard asserts demand<totalCars.
  countClassDemand(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    from: Date,
    to: Date,
  ): Promise<number>
  // #464 2d.2: road-legal supply side of the combo guard. Counts vehicles in
  // (op, class, loc) with status<>'RETIRED' (RETIRED = permanent exit) that
  // are road-legal at asOf (same JST clock as findAvailableVehicles).
  // #1141: a vehicle with a vehicle_blocks row overlapping the demand window
  // [from, to) is off the calendar and must NOT count toward class capacity —
  // mirroring findAvailableVehicles' NOT EXISTS subtraction and the SPECIFIC
  // booking guard's per-car block check. The (from, to) occupancy window leads
  // (matching countClassDemand) so callers pass the same pair to both; asOf —
  // the road-legal clock (the renter's return, distinct from the turnaround-
  // extended window end) — trails as the odd-one-out.
  countClassCapacity(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
    from: Date,
    to: Date,
    asOf: Date,
  ): Promise<number>
  // #464 2d.4: serializes concurrent CLASS_COMBO submits on one (op, class,
  // loc) triple — Postgres' pg_advisory_xact_lock keyed on a hashed string,
  // an InMemory per-key Promise chain in tests. The returned thunk releases:
  // for Drizzle it is a no-op (advisory_xact_lock auto-releases at tx
  // commit/rollback); for InMemory it resolves the queue head so the next
  // waiter advances. The service holds the lock around demand → capacity →
  // insert so a parallel submit can't slip a car under the gate.
  lockComboCapacity(
    operatorId: string,
    classId: string,
    pickupLocationId: string,
  ): Promise<() => void>
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
  /** #394: keep storefronts whose location.regionId is in this set (a region node
   * + its recursive descendants, via RegionRepository). An EMPTY array means "no
   * region matched" → no storefronts; a null regionId never matches. */
  regionIds?: string[]
}

/**
 * #394 hierarchical region taxonomy read. Platform-global reference data (no
 * CallerContext — regions are not tenant-scoped). `findDescendantIds` owns the
 * recursive tree walk in ONE place: BOTH impls delegate to the shared app-code BFS
 * in region-tree.ts (the Drizzle repo loads the tiny tree via findAll, then walks
 * it — see region-tree.ts for why a raw WITH RECURSIVE CTE is avoided). So search
 * services stay dumb: resolve a regionId to a flat id list and hand it to the plain
 * StorefrontFilters.regionIds filter.
 */
export interface RegionRepository {
  /**
   * The whole tree as a flat list of full RegionNode rows. The web client builds
   * the prefecture->city->area cascade from it, AND the location-save geo guard
   * reads the geo columns (lat/lng/assignable/status) off the same rows — because
   * `RegionNode extends RegionCandidate`, one read serves both (#651 Slice 2b).
   */
  findAll(): Promise<Region[]>
  /** `rootId` plus every descendant id (inclusive). Empty when `rootId` is unknown. */
  findDescendantIds(rootId: string): Promise<string[]>
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
    // Server-derived tenant owner (#1205). ensureThread passes booking.operatorId;
    // the caller-facing path leaves it null — operatorId is NEVER read from a
    // request body, so a caller can't assign a thread's tenant scope.
    operatorId?: string | null,
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

// Transaction-runner ports (#392 booking bundle + #521 operator-grant bundle)
// live in ./types-transactions to keep this barrel under the file-size cap
// (#978); re-exported here so callers' imports don't change.
export type {
  OperatorGrantRepos,
  RunInTransaction,
  RunOperatorGrant,
  TransactionRepos,
} from './types-transactions'

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

// VehicleBlockRepository lives in ./types-vehicle-block to keep this barrel under
// the file-size cap (same split as types-review / types-fee-schedule).
export type { VehicleBlockRepository } from './types-vehicle-block'

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

// Fee-schedule contract lives in its own module (file-size cap, #978); re-exported.
export type { FeeScheduleFilters, FeeScheduleRepository } from './types-fee-schedule'

// Renter-document (KYC) data-access interfaces (#459) live in their own module
// to keep this barrel under the file-size cap; re-exported for callers.
export type {
  CreateRenterDocumentData,
  DocumentVerifyInput,
  RenterDocumentFilters,
  RenterDocumentRepository,
} from './types-renter-document'

// Consent data-access interfaces (#613) live in their own module to keep this
// barrel under the file-size cap; re-exported for callers.
export type {
  ConsentAcceptanceListRow,
  ConsentAcceptanceQuery,
  ConsentRepository,
  NewConsentAcceptance,
} from './types-consent'

// Reviews bounded-context data access (#1067 slice 1) lives in its own module;
// re-exported for callers (mirrors the payment/consent split above).
export type { NewReview, ReviewEdit, ReviewRepository } from './types-review'
