/**
 * Operator add-on wire contract (#585; catalog i18n reshape epic #385).
 *
 * The JSON shape `GET/POST/PATCH/DELETE /add-ons` returns and the web add-on
 * client consumes. Web cannot import the Drizzle schema, so the shape lives here,
 * drizzle-free; the status union comes from `@kuruma/shared/enums` (#814).
 *
 * Catalog i18n (slice 2): the operator no longer sees a free-text `name`. The
 * server resolves the picked template's LocalizedText name to the caller locale
 * (`?locale=`) and returns a single `resolvedName` string plus `resolvedDescription`
 * (override-then-template-then-column fall-through). `descriptionOverride` is the
 * RAW authored bundle, returned so the edit form can show/edit the authored-locale
 * slot; `templateId` identifies the picked template (null only for legacy rows in
 * the PR1 nullable window). The old `Jsonified<AddOn>` compile-fence is retired
 * (the producer is now a hand-projected service model, not the row) — the web
 * pins this shape with `satisfies z.ZodType<OperatorAddOnData>` instead.
 */

import type { AddOnStatus } from '../enums'
import type { LocalizedTextOverride } from '../i18n/localized-text'

export interface OperatorAddOnData {
  id: string
  operatorId: string
  /** Picked platform template; null only for legacy rows (PR1 nullable window). */
  templateId: string | null
  /** Template name resolved to the caller locale (English fallback). */
  resolvedName: string
  /** override[locale] -> template[locale] -> template.en -> legacy column -> null. */
  resolvedDescription: string | null
  /** The operator's RAW authored description bag, for the edit form's locale slot. */
  descriptionOverride: LocalizedTextOverride | null
  priceJpy: number
  status: AddOnStatus
}
