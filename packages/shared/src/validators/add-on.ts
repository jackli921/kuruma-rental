import { z } from 'zod'

import { localizedTextOverrideSchema } from '../i18n/localized-text'

// Paid add-ons are operator-owned, selectable priced items chosen in the booking
// wizard (proposal §1.4, §9.19 item 19) — baby seat, ETC card, etc. They are
// distinct from fee_schedules (potential post-rental charges, informational).
// priceJpy is a FLAT per-booking charge (Japan rental norm for optional
// equipment); the per-day model is insurance_options.
//
// Catalog i18n (slice 2): the operator no longer types a free-text name. They
// pick a platform TEMPLATE (which supplies the localized name) and may author a
// description OVERRIDE in one or more locales. `templateId` is a uuid (seedId
// output is v4-shaped, so the seeded catalog validates); `descriptionOverride`
// is the P1-a partial bag (at-least-one-locale, no en-required) so a single-locale
// edit is legal. Field schemas have NO defaults so the update variant reuses the
// same constraints without injecting values on an empty PATCH.
const templateIdSchema = z.string().uuid('A valid add-on template must be selected')
const descriptionOverrideSchema = localizedTextOverrideSchema.nullish()
const priceSchema = z
  .number()
  .int('Price must be a whole number of yen')
  .min(0, 'Price cannot be negative')

export const createAddOnSchema = z.object({
  templateId: templateIdSchema,
  descriptionOverride: descriptionOverrideSchema,
  priceJpy: priceSchema,
})

// Platform-admin writes are cross-tenant, so they MUST name the target operator
// explicitly. Operator callers never send this — the route stamps ctx.operatorId.
export const platformAdminCreateAddOnSchema = createAddOnSchema.extend({
  operatorId: z.string().trim().min(1, 'operatorId is required'),
})

// The template (an add-on's identity) is fixed at create; an edit only touches
// the price and the description override. To offer a different item, archive and
// add a new add-on. `descriptionOverride` stays optional/nullable so an absent
// field leaves it untouched and an explicit null clears it.
export const updateAddOnSchema = z.object({
  descriptionOverride: descriptionOverrideSchema,
  priceJpy: priceSchema.optional(),
})

export type CreateAddOnInput = z.infer<typeof createAddOnSchema>
export type PlatformAdminCreateAddOnInput = z.infer<typeof platformAdminCreateAddOnSchema>
export type UpdateAddOnInput = z.infer<typeof updateAddOnSchema>
