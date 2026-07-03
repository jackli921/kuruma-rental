import { z } from 'zod'

import { CATALOG_TEMPLATE_STATUSES } from '../enums'
import { localizedTextSchema } from '../i18n/localized-text'

/**
 * Platform-admin template library wire contract (#1319).
 *
 * UNLIKE the operator picker (`AddOnTemplatePickerData`, which resolves ONE
 * label to the caller locale), the admin curates the raw multi-locale bundles,
 * so the row carries the full `name` / `description` LocalizedText and EVERY
 * status — including the ARCHIVED, en-only rows the slice-2/3 backfills mint,
 * which stay invisible to every picker until an admin translates + promotes
 * them here. Shared by add-on AND insurance templates (the two catalogs are
 * structurally identical).
 */
export const templateAdminRowSchema = z.object({
  id: z.string(),
  /** slugify(canonical English name) — the stable join handle to an operator row. */
  key: z.string(),
  name: localizedTextSchema,
  description: localizedTextSchema.nullable(),
  status: z.enum(CATALOG_TEMPLATE_STATUSES),
})

export type TemplateAdminRow = z.infer<typeof templateAdminRowSchema>

/** `GET /admin/templates` body: both catalogs, all statuses, raw bundles. */
export const templateLibraryResponseSchema = z.object({
  addOns: z.array(templateAdminRowSchema),
  insurance: z.array(templateAdminRowSchema),
})

export type TemplateLibraryResponse = z.infer<typeof templateLibraryResponseSchema>

/**
 * `PATCH /admin/templates/{add-ons,insurance}/:id` body (#1319 slice 2). One
 * partial covers BOTH admin write intents: translate/curate (`name` /
 * `description` bundles) and promote/archive (`status`) — promote is just
 * `{ status: 'ACTIVE' }` on a backfill-minted ARCHIVED row. Every field optional,
 * but `.refine` rejects an empty body so a no-op PATCH is a 400, not a silent
 * write. `name` keeps the en-required `localizedTextSchema` invariant (a template
 * must always carry its fallback); `description` is nullable to clear it.
 */
export const templatePatchSchema = z
  .object({
    name: localizedTextSchema.optional(),
    description: localizedTextSchema.nullable().optional(),
    status: z.enum(CATALOG_TEMPLATE_STATUSES).optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: 'at least one of name, description, status is required',
  })

export type TemplatePatch = z.infer<typeof templatePatchSchema>
