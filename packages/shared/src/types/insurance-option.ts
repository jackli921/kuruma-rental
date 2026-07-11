/**
 * Operator insurance-option wire contract (#530, compile-pinned #847).
 *
 * The JSON shape `GET/POST/PATCH/DELETE /insurance-options` returns and the web
 * insurance client consumes. Web cannot import the Drizzle schema, so the shape
 * lives here, drizzle-free; the status union comes from `@kuruma/shared/enums` (#814).
 *
 * Dates are ISO 8601 strings (JSON has no Date). The web schema pins to this via
 * `satisfies z.ZodType<InsuranceOptionData>`. Catalog i18n (slice 3b): the operator
 * DTO is a hand-projected service model (`resolvedName` + the raw `nameI18n` bundle,
 * no `name` column), so the old `Jsonified<InsuranceOption>` compile-fence is retired
 * (api `wire-contract.test.ts`) — the `satisfies` pin is now the single seam.
 */

import type { InsuranceStatus } from '../enums'
import type { LocalizedText } from '../i18n/localized-text'

export interface InsuranceOptionData {
  id: string
  operatorId: string
  /** Self-authored name resolved to the caller locale (English fallback). */
  resolvedName: string
  /**
   * The operator's RAW authored name bundle (#1437 slice 3), returned so the edit
   * form can add ja/zh or fix en later (D5). Null for a legacy row, which resolves
   * from the `name` mirror server-side.
   */
  nameI18n: LocalizedText | null
  description: string | null
  dailyPriceJpy: number
  /** null = full cover (no deductible). */
  deductibleJpy: number | null
  status: InsuranceStatus
  /** ISO 8601 (UTC). */
  createdAt: string
  /** ISO 8601 (UTC). */
  updatedAt: string
}
