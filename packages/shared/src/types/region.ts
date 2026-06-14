import type { RegionCandidate } from '../lib/region-distance'

/**
 * Taxonomy level of a region node (#651). Mirrors `regionTypeEnum` in
 * `db/regions.ts`. Nullable on a node because the column is nullable-on-add
 * (the seed populates every row).
 */
export type RegionType = 'PREFECTURE' | 'CITY' | 'AREA'

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
