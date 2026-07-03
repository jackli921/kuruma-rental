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
