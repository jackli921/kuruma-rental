import type { SearchResultItem } from '@kuruma/shared/types/search-result'

/** Stable list key — the renter-safe per-car id for SPECIFIC, the class id for a
 *  future CLASS_COMBO row (#464). Shared by the flat list and the map+list view. */
export function searchResultKey(item: SearchResultItem): string {
  return item.kind === 'SPECIFIC' ? item.vehicleId : item.classId
}
