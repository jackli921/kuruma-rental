import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { LuggageSize } from '@kuruma/shared/lib/luggage'

// JSON-serialized shapes returned by the public storefront endpoints (#391).
// The Vite shell owns these DTOs (rather than importing the frozen Next module's
// copy) so it stays self-contained and free of that module's process.env path.
// These supersede `modules/storefronts/api.ts` — delete that file at cutover
// (#378). The API serializes everything to JSON, so there are no Date instances.

export interface OperatingHoursData {
  openTime: string
  closeTime: string
}

export interface ClassSummaryData {
  /** ACRISS code, or null when the class has no mapped code (#388). */
  acrissCode: string | null
  /** Operator-entered class name; the web localizes via acrissCode. */
  label: string
  // #457 D6: class-default luggage for compare-on-search badges.
  luggageCapacity: number | null
  luggageSize: LuggageSize | null
  availableCount: number
}

export interface StorefrontCardData {
  locationId: string
  operatorId: string
  operatorName: string
  name: string
  address: string
  operatingHours: OperatingHoursData | null
  /** #551: operator turnaround buffer (minutes) between rentals at this store. */
  turnaroundMinutes: number
  classSummaries: ClassSummaryData[]
  fromDailyPriceJpy: number | null
  fromHourlyPriceJpy: number | null
  representativePhotos: string[]
}

export interface StorefrontSearchResultData {
  storefronts: StorefrontCardData[]
  nextCursor: string | null
}

export interface AvailableVehicleData {
  id: string
  name: string
  make: string | null
  model: string | null
  year: number | null
  seats: number
  // #457: effective luggage (vehicle override resolved against the class default).
  luggageCapacity: number | null
  luggageSize: LuggageSize | null
  transmission: 'AUTO' | 'MANUAL'
  acrissCode: string | null
  classLabel: string
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  photos: string[]
}

export interface StorefrontSummaryData {
  locationId: string
  name: string
  address: string
  operatorName: string
  operatingHours: OperatingHoursData | null
  /** #551: operator turnaround buffer (minutes) between rentals at this store. */
  turnaroundMinutes: number
}

export interface StorefrontDetailData {
  storefront: StorefrontSummaryData
  vehicles: AvailableVehicleData[]
  nextCursor: string | null
}

export interface StorefrontSearchParams {
  from: Date
  to: Date
  /** Narrow to a single storefront. */
  pickupLocationId?: string
  /** ACRISS codes (repeatable `class` search param). */
  classes?: string[]
  limit?: number
  cursor?: string
}

export interface StorefrontDetailParams {
  from: Date
  to: Date
  classes?: string[]
  limit?: number
  cursor?: string
}

// Date range + ACRISS filter + cursor pagination are shared by both endpoints.
// Repeatable `class` is appended (not set) so multiple codes survive.
function commonSearchParams(params: {
  from: Date
  to: Date
  classes?: string[]
  limit?: number
  cursor?: string
}): URLSearchParams {
  const sp = new URLSearchParams()
  sp.set('from', params.from.toISOString())
  sp.set('to', params.to.toISOString())
  for (const code of params.classes ?? []) sp.append('class', code)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.cursor) sp.set('cursor', params.cursor)
  return sp
}

// Public endpoint — no auth required. Anonymous renters browse every operator's
// stores; the API projects only renter-safe fields.
export async function fetchStorefronts(
  params: StorefrontSearchParams,
): Promise<StorefrontSearchResultData> {
  const sp = commonSearchParams(params)
  if (params.pickupLocationId) sp.set('pickupLocationId', params.pickupLocationId)
  const res = await fetch(`${getApiBaseUrl()}/storefronts/search?${sp.toString()}`, {
    credentials: 'include',
  })
  return unwrap<StorefrontSearchResultData>(res)
}

// Public endpoint — returns null on 404 (unknown/archived store) so the route
// renders notFound() rather than an error boundary. A known-but-full store
// returns 200 with an empty vehicles array, not 404.
export async function fetchStorefrontDetail(
  locationId: string,
  params: StorefrontDetailParams,
): Promise<StorefrontDetailData | null> {
  const sp = commonSearchParams(params)
  const res = await fetch(
    `${getApiBaseUrl()}/storefronts/${encodeURIComponent(locationId)}/vehicles?${sp.toString()}`,
    { credentials: 'include' },
  )
  if (res.status === 404) return null
  return unwrap<StorefrontDetailData>(res)
}
