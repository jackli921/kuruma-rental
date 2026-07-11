import { z } from 'zod'
import { localizedTextSchema } from '../i18n/localized-text'

// Field schemas WITHOUT defaults, so the update (partial) variant can reuse the
// same constraints without injecting values on an empty PATCH (mirrors the
// location validator). dailyPriceJpy is REQUIRED — an option with no price is
// meaningless (slice-4 plan §12.1). deductibleJpy is nullish: null means full
// cover (no deductible).
//
// #1437 slice 3: insurance is PURELY self-authored — the operator supplies an
// {en, ja?, zh?} bundle (en required, so a self-authored row always has a floor),
// NOT a single-language string. The service mirrors `nameI18n.en` into the `name`
// column (the ACTIVE-name unique seal + booking-snapshot source). No picker, so no
// templateId and no exactly-one refine (unlike add-ons).
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
  nameI18n: localizedTextSchema,
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
