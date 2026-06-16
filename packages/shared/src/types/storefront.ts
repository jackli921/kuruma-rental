/**
 * Renter-safe storefront projection wire contracts (#392/#460, compile-pinned #864).
 *
 * The JSON shapes the public storefront endpoints return and the reservation
 * wizard consumes:
 *   - `GET /storefronts/:id/add-ons`          -> StorefrontAddOnData[]
 *   - `GET /storefronts/:id/insurance-options` -> StorefrontInsuranceData[]
 *
 * These are NARROWER than the operator add-on/insurance rows (#847): only the
 * catalog-visible fields a renter needs to choose extras + coverage at booking.
 * Operator internals (operatorId, status, timestamps) are intentionally absent —
 * the same column-whitelist discipline as the public vehicle catalog.
 *
 * Unlike the #847 operator DTOs, the API producer here is a hand-written service
 * projection (not a Drizzle row), so it can BE this type directly — one source,
 * no `wire-contract` fence. The producer aliases these in
 * `services/storefront-detail.ts`; the web schema pins to them with
 * `satisfies z.ZodType<…>`. A producer-side field rename therefore fails
 * `typecheck` on both ends instead of surfacing as a render-time ParseError in
 * the reservation wizard.
 *
 * Pure type module, no runtime deps. No Date fields — these projections carry no
 * timestamps, so there is nothing to ISO-stringify. Exposed via the explicit
 * subpath export "./types/storefront" in package.json (no types/index barrel).
 */

export interface StorefrontAddOnData {
  id: string
  name: string
  description: string | null
  /** Flat price charged once per booking (not per-day). */
  priceJpy: number
}

export interface StorefrontInsuranceData {
  id: string
  name: string
  description: string | null
  /** Per-day coverage price (billed × rental days). */
  dailyPriceJpy: number
  /** null = full cover (no deductible). */
  deductibleJpy: number | null
}
