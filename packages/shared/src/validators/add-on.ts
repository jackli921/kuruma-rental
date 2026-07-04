import { z } from 'zod'

import { localizedTextOverrideSchema, localizedTextSchema } from '../i18n/localized-text'

// Paid add-ons are operator-owned, selectable priced items chosen in the booking
// wizard (proposal §1.4, §9.19 item 19) — baby seat, ETC card, etc. They are
// distinct from fee_schedules (potential post-rental charges, informational).
// priceJpy is a FLAT per-booking charge (Japan rental norm for optional
// equipment); the per-day model is insurance_options.
//
// Catalog i18n: an add-on is one of two shapes (#1437). Either it PICKS a platform
// TEMPLATE (`templateId`, which supplies the localized name — admin curation still
// propagates) OR it is SELF-AUTHORED (`nameI18n`, the operator owns its own en/ja/zh
// bundle). Exactly one is present per row (the refine below). `templateId` is a uuid
// (seedId output is v4-shaped); `nameI18n` is a full LocalizedText (en required, so a
// self-authored item always has a floor). `descriptionOverride` is the P1-a partial
// bag (at-least-one-locale, no en-required) so a single-locale edit is legal. Field
// schemas have NO defaults so the update variant reuses the same constraints.
const templateIdSchema = z.string().uuid('A valid add-on template must be selected')
const descriptionOverrideSchema = localizedTextOverrideSchema.nullish()
const priceSchema = z
  .number()
  .int('Price must be a whole number of yen')
  .min(0, 'Price cannot be negative')

// Kept as a raw ZodObject so BOTH the operator refine and the platform-admin
// `.extend({operatorId})` derive from it. A `.refine()` turns a schema into a
// ZodEffects, which has no `.extend()` — so the object is the reusable base and
// each caller applies the identity refine to its own leaf (#1437 §7).
const createAddOnObject = z.object({
  templateId: templateIdSchema.optional(),
  nameI18n: localizedTextSchema.optional(),
  descriptionOverride: descriptionOverrideSchema,
  priceJpy: priceSchema,
})

// A row is picked XOR self-authored: exactly one of templateId / nameI18n. Zero
// leaves the add-on without an identity; both is the ambiguous shape the DB CHECK
// also forbids (it would silently discard the operator's nameI18n on the picked
// branch). The error hangs off `templateId` so the picker field surfaces it.
const IDENTITY_MESSAGE = 'Choose a catalog template or author a custom name — exactly one'
const hasExactlyOneIdentity = (data: {
  templateId?: string | undefined
  nameI18n?: unknown
}): boolean => (data.templateId != null) !== (data.nameI18n != null)
const identityRefineOptions = { message: IDENTITY_MESSAGE, path: ['templateId'] }

export const createAddOnSchema = createAddOnObject.refine(
  hasExactlyOneIdentity,
  identityRefineOptions,
)

// Platform-admin writes are cross-tenant, so they MUST name the target operator
// explicitly. Operator callers never send this — the route stamps ctx.operatorId.
// Extend the raw object THEN refine (see createAddOnObject) so the exactly-one rule
// still guards admin-authored rows.
export const platformAdminCreateAddOnSchema = createAddOnObject
  .extend({ operatorId: z.string().trim().min(1, 'operatorId is required') })
  .refine(hasExactlyOneIdentity, identityRefineOptions)

// An edit touches price, the description override, and — for a SELF-AUTHORED row —
// the name bundle (D5: operators can add ja/zh or fix en later). A PICKED row's
// identity is still fixed (the service rejects a nameI18n on a picked row before it
// reaches the DB CHECK). All fields optional/nullable so an absent field leaves the
// column untouched and an explicit null clears the override.
export const updateAddOnSchema = z.object({
  descriptionOverride: descriptionOverrideSchema,
  priceJpy: priceSchema.optional(),
  nameI18n: localizedTextSchema.optional(),
})

export type CreateAddOnInput = z.infer<typeof createAddOnSchema>
export type PlatformAdminCreateAddOnInput = z.infer<typeof platformAdminCreateAddOnSchema>
export type UpdateAddOnInput = z.infer<typeof updateAddOnSchema>
