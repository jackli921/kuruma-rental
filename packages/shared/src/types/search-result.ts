// Cross-operator flat search result DTO (#458). A new presentation layer over
// the slice-5 availability data — NOT a new availability model. The union is
// shaped so a CLASS_COMBO row (#464, fast-follow) drops in without a rewrite;
// only the SPECIFIC producer is built in this slice.
//
// Pure type module, no runtime deps. Exposed via the explicit subpath export
// "./types/search-result" in package.json (the package uses per-module subpaths
// — there is no types/index barrel). Import as
// `@kuruma/shared/types/search-result`, NOT from the `@kuruma/shared` root.

/** Discriminator — mirrors #463 `fulfillment_mode` (SPECIFIC | CLASS_COMBO). */
export type SearchResultKind = 'SPECIFIC' | 'CLASS_COMBO'

/** Location identity + map coordinates, embedded on every result row. */
export interface ResultLocation {
  locationId: string
  operatorId: string
  operatorName: string
  name: string
  address: string
  /** Real coords from locations.latitude (#458 D2). null for a not-yet-geocoded
   *  row — the map degrades gracefully (that row renders list-only). */
  latitude: number | null
  longitude: number | null
}

interface SearchResultBase {
  kind: SearchResultKind
  location: ResultLocation
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  classLabel: string
  acrissCode: string | null
  seats: number
  photos: string[]
}

/** MVP: one physical car. Built now. The renter-safe per-car identity is the
 *  stable `vehicleId` — never the licence plate string (#458 D3). */
export interface SpecificSearchResult extends SearchResultBase {
  kind: 'SPECIFIC'
  vehicleId: string
  name: string
  make: string | null
  model: string | null
  year: number | null
  transmission: 'AUTO' | 'MANUAL'
}

/** FAST-FOLLOW (#464): a class with an inventory count, exact car assigned on
 *  pickup day. Declared now so the union is closed; NO producer this slice. */
export interface ClassComboSearchResult extends SearchResultBase {
  kind: 'CLASS_COMBO'
  classId: string
  availableCount: number
}

export type SearchResultItem = SpecificSearchResult | ClassComboSearchResult

export interface SearchResultsData {
  items: SearchResultItem[]
  nextCursor: string | null
}
