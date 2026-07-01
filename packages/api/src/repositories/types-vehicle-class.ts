import type { CallerContext } from '../middleware/auth'
import type { VehicleClass } from '../stores'

/**
 * Vehicle-class data-access contract. Lives in its own module to keep the
 * `types.ts` barrel under the file-size cap (same split as types-vehicle-block /
 * types-review / types-fee-schedule); re-exported from `types.ts` for callers.
 */
export interface VehicleClassFilters {
  operatorId?: string
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
}

export interface VehicleClassRepository {
  findAll(ctx: CallerContext, filters?: VehicleClassFilters): Promise<VehicleClass[]>
  findById(ctx: CallerContext, id: string): Promise<VehicleClass | undefined>
  findBySlug(ctx: CallerContext, slug: string): Promise<VehicleClass | undefined>
  create(data: Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>): Promise<VehicleClass>
  // #1288: ctx-scoped writes — the tenant predicate is enforced in the WHERE
  // clause (defense-in-depth behind the service's scoped findById).
  update(
    ctx: CallerContext,
    id: string,
    data: Partial<VehicleClass>,
  ): Promise<VehicleClass | undefined>
  archive(ctx: CallerContext, id: string): Promise<VehicleClass | undefined>
}
