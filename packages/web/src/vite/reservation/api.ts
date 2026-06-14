import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { z } from 'zod'

// JSON shapes returned by the public storefront endpoints the reservation wizard
// consumes (#460/#392). The Vite shell owns these DTOs so it stays free of the
// frozen Next module's process.env path. The API serializes to JSON, so there
// are no Date instances. These mirror the renter-safe projections in
// services/storefront-detail.ts (StorefrontAddOn / StorefrontInsuranceOption).

// #711: the schema is the single source — the DTO type is inferred from it, so
// web's compile-time shape and the runtime parse at the seam derive from one
// definition and cannot drift. A renamed/dropped field fails as a ParseError in
// the fetch helpers below instead of surfacing as `undefined` deep in the wizard.
export const reservationAddOnSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Flat price charged once per booking (not per-day). */
  priceJpy: z.number(),
})
export type ReservationAddOn = z.infer<typeof reservationAddOnSchema>

export const reservationInsuranceOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Per-day coverage price (billed × rental days). */
  dailyPriceJpy: z.number(),
  deductibleJpy: z.number().nullable(),
})
export type ReservationInsuranceOption = z.infer<typeof reservationInsuranceOptionSchema>

// Public endpoints — no auth. ACTIVE-only, single-operator reads (the API seals
// cross-tenant leaks). A 404 (unknown/archived storefront) surfaces as an
// ApiError so the wizard loader can bounce the renter back to search.
export async function fetchAddOns(locationId: string): Promise<ReservationAddOn[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/storefronts/${encodeURIComponent(locationId)}/add-ons`,
    { credentials: 'include' },
  )
  return unwrap(res, reservationAddOnSchema.array())
}

export async function fetchInsuranceOptions(
  locationId: string,
): Promise<ReservationInsuranceOption[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/storefronts/${encodeURIComponent(locationId)}/insurance-options`,
    { credentials: 'include' },
  )
  return unwrap(res, reservationInsuranceOptionSchema.array())
}
