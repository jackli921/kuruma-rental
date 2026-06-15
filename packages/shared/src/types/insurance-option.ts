/**
 * Operator insurance-option wire contract (#530, compile-pinned #847).
 *
 * The JSON shape `GET/POST/PATCH/DELETE /insurance-options` returns and the web
 * insurance client consumes. Web cannot import the Drizzle schema, so the shape
 * lives here, drizzle-free; the status union comes from `@kuruma/shared/enums` (#814).
 *
 * Dates are ISO 8601 strings (JSON has no Date). The web schema pins to this via
 * `satisfies z.ZodType<InsuranceOptionData>` and the API row type is fenced against
 * `Jsonified<InsuranceOption>` (api `wire-contract.test.ts`), so a producer-side
 * field rename fails `typecheck` instead of surfacing as a runtime ParseError.
 */

import type { InsuranceStatus } from '../enums'

export interface InsuranceOptionData {
  id: string
  operatorId: string
  name: string
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
