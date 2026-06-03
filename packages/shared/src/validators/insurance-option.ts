import { z } from 'zod'

// Field schemas WITHOUT defaults, so the update (partial) variant can reuse the
// same constraints without injecting values on an empty PATCH (mirrors the
// location validator). dailyPriceJpy is REQUIRED — an option with no price is
// meaningless (slice-4 plan §12.1). deductibleJpy is nullish: null means full
// cover (no deductible).
const nameSchema = z.string().trim().min(1, 'Name is required').max(200)
const descriptionSchema = z.string().trim().max(2000).nullish()
const dailyPriceSchema = z
  .number()
  .int('Daily price must be a whole number of yen')
  .min(0, 'Daily price cannot be negative')
const deductibleSchema = z
  .number()
  .int('Deductible must be a whole number of yen')
  .min(0, 'Deductible cannot be negative')
  .nullish()

export const createInsuranceOptionSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  dailyPriceJpy: dailyPriceSchema,
  deductibleJpy: deductibleSchema,
})

// Platform-admin writes are cross-tenant, so they MUST name the target operator
// explicitly. Operator callers never send this — the route stamps ctx.operatorId.
export const platformAdminCreateInsuranceOptionSchema = createInsuranceOptionSchema.extend({
  operatorId: z.string().trim().min(1, 'operatorId is required'),
})

export const updateInsuranceOptionSchema = createInsuranceOptionSchema.partial()

export type CreateInsuranceOptionInput = z.infer<typeof createInsuranceOptionSchema>
export type PlatformAdminCreateInsuranceOptionInput = z.infer<
  typeof platformAdminCreateInsuranceOptionSchema
>
export type UpdateInsuranceOptionInput = z.infer<typeof updateInsuranceOptionSchema>
