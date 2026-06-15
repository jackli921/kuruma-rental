/**
 * Operator fee-schedule wire contract (#530, compile-pinned #847).
 *
 * This is the JSON shape `GET/POST/PATCH/DELETE /fee-schedules` returns and the
 * web fee-schedule client consumes. Web cannot import the Drizzle schema, so the
 * shape lives here, drizzle-free; the enum members come from `@kuruma/shared/enums`
 * (the const-SSoT that keeps Drizzle out of the web edge bundle, #814).
 *
 * Dates are ISO 8601 strings (JSON has no Date). The web schema pins to this via
 * `satisfies z.ZodType<FeeScheduleData>` and the API row type is fenced against
 * `Jsonified<FeeSchedule>` (api `wire-contract.test.ts`), so a producer-side
 * field rename fails `typecheck` instead of surfacing as a runtime ParseError.
 */

import type { FeeScheduleStatus, FeeType, FeeUnit } from '../enums'

export interface FeeScheduleData {
  id: string
  operatorId: string
  /** null = operator-wide fee; non-null = scoped to one vehicle class. */
  vehicleClassId: string | null
  feeType: FeeType
  unit: FeeUnit
  amountJpy: number
  status: FeeScheduleStatus
  /** ISO 8601 (UTC). */
  createdAt: string
  /** ISO 8601 (UTC). */
  updatedAt: string
}
