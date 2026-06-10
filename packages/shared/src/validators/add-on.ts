import { z } from 'zod'

// Paid add-ons are operator-owned, selectable priced items chosen in the booking
// wizard (proposal §1.4, §9.19 item 19) — baby seat, ETC card, etc. They are
// distinct from fee_schedules (potential post-rental charges, informational).
// priceJpy is a FLAT per-booking charge (Japan rental norm for optional
// equipment); the per-day model is insurance_options. Field schemas have NO
// defaults so the update (partial) variant reuses the same constraints without
// injecting values on an empty PATCH (mirrors insurance-option.ts).
const nameSchema = z.string().trim().min(1, 'Name is required').max(200)
const descriptionSchema = z.string().trim().max(2000).nullish()
const priceSchema = z
  .number()
  .int('Price must be a whole number of yen')
  .min(0, 'Price cannot be negative')

export const createAddOnSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  priceJpy: priceSchema,
})

// Platform-admin writes are cross-tenant, so they MUST name the target operator
// explicitly. Operator callers never send this — the route stamps ctx.operatorId.
export const platformAdminCreateAddOnSchema = createAddOnSchema.extend({
  operatorId: z.string().trim().min(1, 'operatorId is required'),
})

export const updateAddOnSchema = createAddOnSchema.partial()

export type CreateAddOnInput = z.infer<typeof createAddOnSchema>
export type PlatformAdminCreateAddOnInput = z.infer<typeof platformAdminCreateAddOnSchema>
export type UpdateAddOnInput = z.infer<typeof updateAddOnSchema>
