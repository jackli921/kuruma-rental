import { z } from 'zod'
import { FEE_TYPES, FEE_UNITS, type FeeType, type FeeUnit } from '../enums'
import { jpyAmount } from './money'

// Re-exported from the enum SSoT (#688) under their original names so the
// `fee_type`/`fee_unit` pgEnums, this validator, and every existing consumer all
// share one declaration.
export { FEE_TYPES, FEE_UNITS, type FeeType, type FeeUnit }

/**
 * The unit each fee type must use (slice 4b / #405). MVP fee types map 1:1 to a
 * unit; PER_DAY / PER_KM stay in the enum (proposal §12.2) for future fee types
 * but no current type may use them. Single source of truth — the validator
 * `.superRefine()` and the service merge-then-validate both read from this.
 */
export const REQUIRED_UNIT_BY_FEE_TYPE: Record<FeeType, FeeUnit> = {
  OVERTIME_HOURLY: 'PER_HOUR',
  CLEANING_FLAT: 'FLAT',
  NO_FUEL_FLAT: 'FLAT',
}

/**
 * True when `unit` is the unit required for `feeType`. Pulled out so the service
 * can reuse the exact same coherence rule on a merged (existing + patch) value,
 * where the schema's `.superRefine()` cannot fire (a unit-only PATCH never sees
 * feeType). See plan §4 [P1].
 */
export function isCoherentFeeUnit(feeType: FeeType, unit: FeeUnit): boolean {
  return REQUIRED_UNIT_BY_FEE_TYPE[feeType] === unit
}

export function feeUnitCoherenceMessage(feeType: FeeType): string {
  return `${feeType} fees must use the ${REQUIRED_UNIT_BY_FEE_TYPE[feeType]} unit`
}

const amountSchema = jpyAmount('Amount')

const feeScheduleObjectSchema = z.object({
  feeType: z.enum(FEE_TYPES),
  unit: z.enum(FEE_UNITS),
  amountJpy: amountSchema,
  // null / omitted = operator-wide fee. When set it must be a UUID; existence
  // (and same-operator) is sealed by the composite DB FK, not here.
  vehicleClassId: z.string().uuid('vehicleClassId must be a UUID').nullish(),
})

// Attach the coherence error to `unit` so the form renders it under the unit
// field. Create-time both-keys-present check; the same rule runs in the service
// on the merged value for partial PATCHes.
function refineCoherence(
  data: { feeType?: FeeType | undefined; unit?: FeeUnit | undefined },
  ctx: z.RefinementCtx,
): void {
  if (data.feeType !== undefined && data.unit !== undefined) {
    if (!isCoherentFeeUnit(data.feeType, data.unit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unit'],
        message: feeUnitCoherenceMessage(data.feeType),
      })
    }
  }
}

export const createFeeScheduleSchema = feeScheduleObjectSchema.superRefine(refineCoherence)

// Platform-admin writes are cross-tenant, so they MUST name the target operator
// explicitly (mirrors platformAdminCreateLocationSchema). Operator callers never
// send this — the route stamps ctx.operatorId.
export const platformAdminCreateFeeScheduleSchema = feeScheduleObjectSchema
  .extend({
    operatorId: z.string().trim().min(1, 'operatorId is required'),
  })
  .superRefine(refineCoherence)

// .partial() so a PATCH can carry any subset. The coherence refine stays as a
// both-keys-present fast-path only — a unit-only patch never sees feeType, so
// the FeeScheduleService validates coherence on the merged value (plan §4 [P1]).
export const updateFeeScheduleSchema = feeScheduleObjectSchema
  .partial()
  .superRefine(refineCoherence)

export type CreateFeeScheduleInput = z.infer<typeof createFeeScheduleSchema>
export type CreateFeeScheduleFormInput = z.input<typeof createFeeScheduleSchema>
export type PlatformAdminCreateFeeScheduleInput = z.infer<
  typeof platformAdminCreateFeeScheduleSchema
>
export type UpdateFeeScheduleInput = z.infer<typeof updateFeeScheduleSchema>
