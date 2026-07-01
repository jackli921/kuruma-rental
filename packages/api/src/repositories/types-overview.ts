import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { OperatorOverview } from '@kuruma/shared/types/overview'
import type { CallerContext } from '../middleware/auth'

// The projection DTOs live in @kuruma/shared; re-exported here so the
// repositories/types barrel keeps its historical surface (#1265).
export type { OperatorOverview } from '@kuruma/shared/types/overview'
export type { FleetVehicleOverview, FleetBookingSummary } from '@kuruma/shared/types/fleet'

// Aggregated read for the owner-facing /manage/vehicles list. Enriches
// each vehicle with utilization %, booking count, and current/next
// booking state. Computed per-request — NOT denormalized into the
// vehicles table. See issue #52 and @kuruma/shared/types/fleet.
//
// Split from VehicleRepository because it reads across multiple tables
// (vehicles + bookings + users.name) — following the same boundary as
// AvailabilityRepository, which also reads vehicles + bookings.
export interface FleetOverviewRepository {
  // `now` is injected so time cutoffs live in callers; tests pass a fixed Date.
  // `ctx` scopes the read (#594); `operatorId` (#407 slice 4, bypass-gated)
  // narrows a bypass caller to one operator — see narrowReadToOperator.
  findFleetOverview(
    ctx: CallerContext,
    now: Date,
    operatorId?: string,
  ): Promise<FleetVehicleOverview[]>
}

/**
 * Operator-scoped dashboard counts (#524). `ctx` decides the tenant scope via
 * {@link bookingReadScope}: bypass roles aggregate across all operators, an
 * OPERATOR_* caller sees only its own tenant, and an operator missing its
 * operatorId fails closed to zeros (mirrors how its own bookings list behaves).
 * `now` is injected so "upcoming" is deterministic in tests.
 */
export interface OverviewRepository {
  // `operatorId` (#407 slice 4, bypass-gated): narrows a bypass caller — see narrowReadToOperator.
  getOperatorOverview(ctx: CallerContext, now: Date, operatorId?: string): Promise<OperatorOverview>
}
