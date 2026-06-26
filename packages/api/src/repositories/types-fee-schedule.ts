// Fee-schedule data-access contract (overtime / cleaning / no-fuel fees) lives in
// its own module to keep the repositories/types.ts barrel under the file-size cap
// (#978); re-exported from ./types so callers' imports don't change.
import type { CallerContext } from '../middleware/auth'
import type { FeeSchedule } from '../stores'

export interface FeeScheduleFilters {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
  /**
   * Explicit tenant filter. ONLY the bypass route layer sets this (from
   * `?operatorId=`); it narrows a bypass-role read to one tenant. IGNORED for
   * operator callers — their scope is absolute (see findAll precedence).
   */
  operatorId?: string
  /**
   * Explicit platform-wide read (#1107). Set by the bypass-role route layer
   * (from `?includeAll=true`) and by the in-memory storefront double (the public
   * marketplace catalog is an explicit cross-operator read). A bypass caller
   * with NEITHER `operatorId` nor this flag reads nothing — the safe default
   * lives in the repo, so a forgotten route guard can no longer leak every
   * tenant's private config.
   */
  includeAllOperators?: boolean
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
