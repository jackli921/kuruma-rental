import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { Locale } from '@kuruma/shared/i18n/locales'
import type { StorefrontAddOnData, StorefrontInsuranceData } from '@kuruma/shared/types/storefront'
import { z } from 'zod'

// JSON shapes returned by the public storefront endpoints the reservation wizard
// consumes (#460/#392). The Vite shell owns the runtime schema so it stays free
// of the frozen Next module's process.env path. The API serializes to JSON, so
// there are no Date instances.

// #711/#864: the shared `Storefront*Data` DTO is the single source. The schema
// pins to it with `satisfies z.ZodType<…>`, and the API producer (storefront-
// detail.ts) aliases the SAME DTO, so web's compile-time shape and the producer
// derive from one definition and cannot drift. A producer-side field rename
// fails `typecheck` on both ends; a runtime body that drifts fails as a
// ParseError in the fetch helpers below instead of surfacing as `undefined` deep
// in the wizard.
export const reservationAddOnSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Flat price charged once per booking (not per-day). */
  priceJpy: z.number(),
}) satisfies z.ZodType<StorefrontAddOnData>
export type ReservationAddOn = StorefrontAddOnData

export const reservationInsuranceOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Per-day coverage price (billed × rental days). */
  dailyPriceJpy: z.number(),
  deductibleJpy: z.number().nullable(),
}) satisfies z.ZodType<StorefrontInsuranceData>
export type ReservationInsuranceOption = StorefrontInsuranceData

// Public endpoints — no auth. ACTIVE-only, single-operator reads (the API seals
// cross-tenant leaks). A 404 (unknown/archived storefront) surfaces as an
// ApiError so the wizard loader can bounce the renter back to search.
//
// Catalog i18n slice 2 (#1315): add-on name/description are templated + resolved
// server-side to `?locale=`, so the renter read threads its route locale (absent
// ⇒ server default EN). A bad locale is a 400 the server never caches, so the
// wizard only ever passes a validated `Locale`. Insurance stays EN until slice 3.
export async function fetchAddOns(
  locationId: string,
  locale?: Locale,
): Promise<ReservationAddOn[]> {
  const localeParam = locale ? `?locale=${locale}` : ''
  const res = await fetch(
    `${getApiBaseUrl()}/storefronts/${encodeURIComponent(locationId)}/add-ons${localeParam}`,
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
