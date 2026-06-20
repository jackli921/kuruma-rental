import type { UserRole } from '@kuruma/shared/auth/roles'
import { isRoadLegal, jstDateString } from '@kuruma/shared/lib/compliance'
import { STAFF_ROLES } from '../middleware/auth'
import type {
  AvailabilityFilters,
  AvailabilityRepository,
  Booking,
  Vehicle,
} from '../repositories/types'

/** Time-window projection of a conflicting booking shown to non-staff callers.
 *  Everything that could identify the other renter (id, renterId, notes, status)
 *  is dropped — a renter learns only *when* a vehicle is taken, never by whom. */
export type RedactedConflict = Pick<Booking, 'startAt' | 'effectiveEndAt'>

/** Discriminated result so the route maps to an HTTP shape without re-deriving
 *  the availability/redaction policy (FC/IS: this service is the pure core). */
export type VehicleAvailabilityResult =
  | { kind: 'not_found' }
  | { kind: 'available'; vehicle: Vehicle }
  | { kind: 'unavailable'; vehicle: Vehicle; conflicts: Booking[] | RedactedConflict[] }

export class AvailabilityService {
  constructor(private readonly repo: AvailabilityRepository) {}

  async findAvailableVehicles(
    from: Date,
    to: Date,
    filters?: AvailabilityFilters,
  ): Promise<Vehicle[]> {
    return this.repo.findAvailableVehicles(from, to, filters)
  }

  async checkVehicleAvailability(
    vehicleId: string,
    from: Date,
    to: Date,
    viewerRole: UserRole | undefined,
  ): Promise<VehicleAvailabilityResult> {
    const result = await this.repo.checkVehicleAvailability(vehicleId, from, to)
    if (!result) return { kind: 'not_found' }
    // §5.2 (#916): the repo only checks booking conflicts, so an expired car
    // would report available. Gate on road-legality THROUGH the requested return
    // (same JST clock as list/create) — a non-road-legal car is unavailable with
    // no conflicts to disclose.
    const roadLegal = isRoadLegal(result.vehicle, jstDateString(to))
    if (result.available && roadLegal) return { kind: 'available', vehicle: result.vehicle }

    const isStaff = viewerRole != null && STAFF_ROLES.has(viewerRole)
    const conflicts = isStaff
      ? result.conflicts
      : result.conflicts.map((b) => ({ startAt: b.startAt, effectiveEndAt: b.effectiveEndAt }))
    return { kind: 'unavailable', vehicle: result.vehicle, conflicts }
  }
}
