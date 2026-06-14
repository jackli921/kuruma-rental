/**
 * Request-filter contracts accepted by the service layer.
 *
 * These shapes are defined alongside the repository interfaces (their primary
 * consumer), but routes must reach them through the service layer rather than
 * importing from `repositories/types` directly — keeping the import direction
 * routes -> services -> repositories intact. See #726.
 *
 * DI-only routes that hold a repository as their constructor contract
 * (regions, stats, vehicles) keep importing the `*Repository` interface from
 * `repositories/types`; that is the documented carve-out, not a filter shape.
 */
export type {
  AddOnFilters,
  BookingFilters,
  FeeScheduleFilters,
  InsuranceOptionFilters,
  LocationFilters,
  NotificationLogFilters,
} from '../repositories/types'
