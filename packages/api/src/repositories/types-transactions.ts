import type {
  AddOnRepository,
  AvailabilityRepository,
  BookingEventRepository,
  BookingRepository,
  FeeScheduleRepository,
  InsuranceOptionRepository,
  LocationRepository,
  MaintenanceLogRepository,
  OperatorMembershipRepository,
  ProviderInviteRepository,
  UserRepository,
  VehicleBlockRepository,
  VehicleClassRepository,
  VehicleRepository,
} from './types'
import type { ClassRatePlanRepository } from './types-pricing'

// Transaction-runner ports (#392 booking bundle + #521 operator-grant bundle)
// live in their own module to keep the types.ts barrel under the file-size
// cap (#978); re-exported from ./types so callers' imports don't change.

// Transaction boundary across repos. Drizzle wraps db.transaction() and binds
// repos to the tx handle; InMemory passes singletons through. Slice 6 (#392)
// widened the bundle so the booking submit validates availability + appends
// BOOKING_CREATED + reads vehicle/location/insurance/fee rows in one tx.
export interface TransactionRepos {
  vehicleRepo: VehicleRepository
  maintenanceLogRepo: MaintenanceLogRepository
  bookingRepo: BookingRepository
  bookingEventRepo: BookingEventRepository
  locationRepo: LocationRepository
  insuranceOptionRepo: InsuranceOptionRepository
  addOnRepo: AddOnRepository
  feeScheduleRepo: FeeScheduleRepository
  // #875: walk-in renter (#589 1c) is created INSIDE the booking tx so a
  // failed booking rolls the renter back with it (no orphan).
  userRepo: Pick<UserRepository, 'createWalkInRenter'>
  // #464 2d: CLASS_COMBO submit reads demand+capacity, acquires the per-triple
  // advisory lock, prices via findActiveRate, and validates classId↔operator
  // in-tx — single point-in-time view (slice 2d.2/2d.4 grow AvailabilityRepository).
  availabilityRepo: AvailabilityRepository
  classRatePlanRepo: ClassRatePlanRepository
  vehicleClassRepo: VehicleClassRepository
  // #1101: the SPECIFIC booking submit reads overlapping blocks in-tx to reject a
  // booking that lands on a scheduled maintenance/hold window (a single GiST
  // EXCLUDE can't span bookings + vehicle_blocks). Read-only here.
  vehicleBlockRepo: Pick<VehicleBlockRepository, 'findOverlapping'>
}

export type RunInTransaction = <T>(fn: (repos: TransactionRepos) => Promise<T>) => Promise<T>

// #521 §6: minimal write surface for the atomic operator-grant tx — membership
// ledger INSERT, denormalised users projection, invite consumption. Membership
// INSERT goes first so the partial-unique-active index aborts the whole tx on
// a concurrent double-accept; the service then re-reads the winner.
export interface OperatorGrantRepos {
  memberships: Pick<OperatorMembershipRepository, 'create'>
  users: Pick<UserRepository, 'setOperatorAccess'>
  invites: Pick<ProviderInviteRepository, 'markAccepted'>
}

// Drizzle wires the real per-call neon-serverless tx (#493, pooled DATABASE_URL);
// InMemory passes the plain repos (single-threaded, no real tx). Mirrors
// RunInTransaction (the booking bundle) but scoped to the grant's three tables.
export type RunOperatorGrant = <T>(fn: (repos: OperatorGrantRepos) => Promise<T>) => Promise<T>
