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
import type { LocalizedText, LocalizedTextOverride } from '../i18n/localized-text'

export interface OperatorAddOnData {
  id: string
  operatorId: string
  /** Picked platform template; null for a self-authored row or a legacy row. */
  templateId: string | null
  /** Template or self-authored name resolved to the caller locale (English fallback). */
  resolvedName: string
  /** override[locale] -> template[locale] -> template.en -> legacy column -> null. */
  resolvedDescription: string | null
  /** The operator's RAW authored description bag, for the edit form's locale slot. */
  descriptionOverride: LocalizedTextOverride | null
  /**
   * SELF-AUTHORED name bundle (#1437), returned RAW so the edit form can add ja/zh
   * or fix en later (D5). Null for a PICKED row (the template owns the name) and
   * for a legacy row — mutually exclusive with a non-null `templateId`.
   */
  nameI18n: LocalizedText | null
  priceJpy: number
  status: AddOnStatus
}
