/**
 * Operator add-on wire contract (#585, compile-pinned #847).
 *
 * The JSON shape `GET/POST/PATCH/DELETE /add-ons` returns and the web add-on
 * client consumes. Web cannot import the Drizzle schema, so the shape lives here,
 * drizzle-free; the status union comes from `@kuruma/shared/enums` (#814).
 *
 * Dates are ISO 8601 strings (JSON has no Date). The web schema pins to this via
 * `satisfies z.ZodType<AddOnData>` and the API row type is fenced against
 * `Jsonified<AddOn>` (api `wire-contract.test.ts`), so a producer-side field
 * rename fails `typecheck` instead of surfacing as a runtime ParseError.
 */

import type { AddOnStatus } from '../enums'

export interface AddOnData {
  id: string
  operatorId: string
  name: string
  description: string | null
  priceJpy: number
  status: AddOnStatus
  /** ISO 8601 (UTC). */
  createdAt: string
  /** ISO 8601 (UTC). */
  updatedAt: string
}
