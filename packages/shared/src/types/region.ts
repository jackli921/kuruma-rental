import type { RegionType } from '../enums'
import type { RegionCandidate } from '../lib/region-distance'

// RegionType (PREFECTURE | CITY | AREA) is the enums SSoT (#814); db/regions.ts'
// regionTypeEnum derives from the same const. Re-exported here so existing
// `@kuruma/shared/types/region` consumers keep a single import path.
export type { RegionType }

/**
 * A full region taxonomy row as returned by `GET /regions` (#651 Slice 2b).
 *
 * Superset of {@link RegionCandidate}: it carries the geo-match fields
 * (latitude/longitude/assignable/status/sortOrder) the location-save loop guard
 * needs AND the cascade/tree fields (parentId, trilingual names, type, slug) the
 * operator prefecture->city->area dropdowns + the renter picker (#651 Slice 3)
 * need. Because it extends RegionCandidate, `nearestAssignableRegion` accepts a
 * `RegionNode[]` directly, so one repository read (`findAll`) now feeds both the
 * cascade and the geo guard — the narrower `findCandidates` projection is gone.
 */
export interface RegionNode extends RegionCandidate {
  parentId: string | null
  nameEn: string
  nameJa: string
  nameZh: string
  type: RegionType | null
  slug: string | null
}
