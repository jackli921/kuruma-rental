import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'

// JSON shapes returned by the public storefront endpoints the reservation wizard
// consumes (#460/#392). The Vite shell owns these DTOs so it stays free of the
// frozen Next module's process.env path. The API serializes to JSON, so there
// are no Date instances. These mirror the renter-safe projections in
// services/storefront-detail.ts (StorefrontAddOn / StorefrontInsuranceOption).

export interface ReservationAddOn {
  id: string
  name: string
  description: string | null
  /** Flat price charged once per booking (not per-day). */
  priceJpy: number
}

export interface ReservationInsuranceOption {
  id: string
  name: string
  description: string | null
  /** Per-day coverage price (billed × rental days). */
  dailyPriceJpy: number
  deductibleJpy: number | null
}

// Public endpoints — no auth. ACTIVE-only, single-operator reads (the API seals
// cross-tenant leaks). A 404 (unknown/archived storefront) surfaces as an
// ApiError so the wizard loader can bounce the renter back to search.
export async function fetchAddOns(locationId: string): Promise<ReservationAddOn[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/storefronts/${encodeURIComponent(locationId)}/add-ons`,
    { credentials: 'include' },
  )
  return unwrap<ReservationAddOn[]>(res)
}

export async function fetchInsuranceOptions(
  locationId: string,
): Promise<ReservationInsuranceOption[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/storefronts/${encodeURIComponent(locationId)}/insurance-options`,
    { credentials: 'include' },
  )
  return unwrap<ReservationInsuranceOption[]>(res)
}
