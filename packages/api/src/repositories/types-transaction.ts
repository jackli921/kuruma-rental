import type {
  AddOnRepository,
  AvailabilityRepository,
  BookingEventRepository,
  BookingRepository,
  ClassRatePlanRepository,
  FeeScheduleRepository,
  InsuranceOptionRepository,
  LocationRepository,
  MaintenanceLogRepository,
  OperatorMembershipRepository,
  ProviderInviteRepository,
  UserRepository,
  VehicleRepository,
} from './types'

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
  // #464 slice 2: the inventory-guard reads (demand + capacity) and the combo
  // rate-plan price must run on the SAME tx connection as the booking insert, so
  // the advisory lock that serialises count-then-insert actually holds across them.
  availabilityRepo: AvailabilityRepository
  classRatePlanRepo: ClassRatePlanRepository
  /**
   * #464 slice 2: hold the per-(operator, location, class) capacity lock for the
   * REST of this transaction (pg_advisory_xact_lock). It orders concurrent
   * count-then-insert so two floats can't both pass `demand < capacity` for the
   * last car. Real in the Drizzle tx factory; a no-op in the single-threaded
   * in-memory bundles (the guard math still runs there to cover the invariant).
   */
  acquireClassCapacityLock(
    operatorId: string,
    pickupLocationId: string,
    classId: string,
  ): Promise<void>
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
