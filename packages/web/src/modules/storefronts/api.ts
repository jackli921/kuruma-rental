import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

// --- JSON-serialized shapes returned by the public storefront endpoints (#391).
// The API serializes everything to JSON, so there are no Date instances here.

export interface OperatingHoursData {
  openTime: string
  closeTime: string
}

export interface ClassSummaryData {
  /** ACRISS code, or null when the class has no mapped code (#388). */
  acrissCode: string | null
  /** Operator-entered class name; the web localizes via acrissCode. */
  label: string
  availableCount: number
}

export interface StorefrontCardData {
  locationId: string
  operatorId: string
  operatorName: string
  name: string
  address: string
  operatingHours: OperatingHoursData | null
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
  /** ACRISS codes (repeatable `class` query param). */
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

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<T>

  if (!body.success) {
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }

  return body.data
}

// Date range + ACRISS filter + cursor pagination are shared by both endpoints.
// Repeatable `class` is appended (not set) so multiple codes survive.
function applyCommonParams(
  url: URL,
  params: { from: Date; to: Date; classes?: string[]; limit?: number; cursor?: string },
): void {
  url.searchParams.set('from', params.from.toISOString())
  url.searchParams.set('to', params.to.toISOString())
  for (const code of params.classes ?? []) url.searchParams.append('class', code)
  if (params.limit) url.searchParams.set('limit', String(params.limit))
  if (params.cursor) url.searchParams.set('cursor', params.cursor)
}

// Public endpoint — no auth token. Anonymous renters browse every operator's
// stores; the API projects only renter-safe fields.
export async function fetchStorefronts(
  params: StorefrontSearchParams,
): Promise<StorefrontSearchResultData> {
  const client = createApiClient()
  const url = client.storefronts.search.$url()
  applyCommonParams(url, params)
  if (params.pickupLocationId) url.searchParams.set('pickupLocationId', params.pickupLocationId)
  const res = await fetch(url)
  return unwrap<StorefrontSearchResultData>(res)
}

// Public endpoint — returns null on 404 (unknown/archived store) so the page
// renders notFound() rather than an error boundary. A known-but-full store
// returns 200 with an empty vehicles array, not 404.
export async function fetchStorefrontDetail(
  locationId: string,
  params: StorefrontDetailParams,
): Promise<StorefrontDetailData | null> {
  const client = createApiClient()
  const url = client.storefronts[':locationId'].vehicles.$url({ param: { locationId } })
  applyCommonParams(url, params)
  const res = await fetch(url)
  if (res.status === 404) return null
  return unwrap<StorefrontDetailData>(res)
}
