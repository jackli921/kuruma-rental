import { regions } from '@kuruma/shared/db/schema'
import { asc } from 'drizzle-orm'
import type { Region } from '../../stores'
import { collectDescendantIds } from '../region-tree'
import type { RegionRepository } from '../types'
import type { Db } from './shared'

const regionColumns = {
  id: regions.id,
  parentId: regions.parentId,
  nameEn: regions.nameEn,
  nameJa: regions.nameJa,
  nameZh: regions.nameZh,
  sortOrder: regions.sortOrder,
}

/**
 * #394 region taxonomy read. `findAll` is ordered by (sortOrder, nameEn) so the
 * cascading dropdowns render stably without client-side sorting. Descendant
 * resolution loads the (tiny) tree and walks it in app code via the shared pure
 * helper — see region-tree.ts for why we avoid a raw recursive CTE here.
 */
export class DrizzleRegionRepository implements RegionRepository {
  constructor(private readonly db: Db) {}

  async findAll(): Promise<Region[]> {
    return this.db
      .select(regionColumns)
      .from(regions)
      .orderBy(asc(regions.sortOrder), asc(regions.nameEn))
  }

  async findDescendantIds(rootId: string): Promise<string[]> {
    return collectDescendantIds(await this.findAll(), rootId)
  }
}
