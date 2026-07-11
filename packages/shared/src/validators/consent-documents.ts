import { z } from 'zod'

const localizedTermsSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  acceptanceLabel: z.string().min(1).max(200),
})
export type LocalizedTerms = z.infer<typeof localizedTermsSchema>

/** Operator save-draft input. `en` required; `ja`/`zh` optional (fall back to en at read). */
export const saveOperatorTermsDraftSchema = z.object({
  en: localizedTermsSchema,
  ja: localizedTermsSchema.optional(),
  zh: localizedTermsSchema.optional(),
  effectiveFrom: z.string().datetime().optional(),
})
export type SaveOperatorTermsDraftInput = z.infer<typeof saveOperatorTermsDraftSchema>

/** Platform-admin variant — may name the target operator via the picker. */
export const platformAdminSaveOperatorTermsDraftSchema = saveOperatorTermsDraftSchema.extend({
  operatorId: z.string().min(1).optional(),
})
