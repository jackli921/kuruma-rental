import { z } from 'zod'

import type { Locale } from './locales'

/**
 * A localized text bundle: the shape behind every catalog template name /
 * description and every operator description override.
 *
 * `en` is REQUIRED (the guaranteed fallback), other locales optional, unknown
 * keys rejected (`.strict()`), and every present value `.min(1)` so an empty
 * slot can never render blank — the resolver only falls through on an
 * absent/undefined locale.
 *
 * Hand-written literal (NOT a reduce over SUPPORTED_LOCALES) to keep the
 * en-required precision; adding a locale is one optional line here.
 */
export const localizedTextSchema = z
  .object({
    en: z.string().min(1),
    ja: z.string().min(1).optional(),
    zh: z.string().min(1).optional(),
  })
  .strict()

export type LocalizedText = z.infer<typeof localizedTextSchema>

/**
 * P1-a: an operator's description OVERRIDE has a different invariant than a
 * template bundle. An operator may author in one locale only (a `/ja` edit is
 * `{ ja: '...' }`), so NO locale — not even `en` — is required, but the bundle
 * must carry at least one key (an empty override is meaningless). A separate
 * type, never reused as `LocalizedText`: sharing one en-required type would
 * either reject a valid single-locale edit or force fake English into `en`
 * (which then renders as everyone's fallback).
 */
export const localizedTextOverrideSchema = z
  .object({
    en: z.string().min(1).optional(),
    ja: z.string().min(1).optional(),
    zh: z.string().min(1).optional(),
  })
  .strict()
  .refine((bundle) => Object.keys(bundle).length > 0, 'at least one locale required')

export type LocalizedTextOverride = z.infer<typeof localizedTextOverrideSchema>

/**
 * The one resolver for template name, template description, and override.
 * Falls back to `en` when the requested locale is absent. Typechecks under
 * `noUncheckedIndexedAccess` (`bundle[locale]` is `string | undefined`).
 */
export function resolveLocalized(bundle: LocalizedText, locale: Locale): string {
  return bundle[locale] ?? bundle.en
}

/**
 * P1-a: resolve an operator row's description with per-locale fall-through:
 * `override[locale]` -> `template[locale]` -> `template.en` -> `null`.
 *
 * The override may lack the requested locale (and `en`), so it NEVER
 * short-circuits the chain: a ja-only override under a zh reader falls to the
 * template's zh, never to the override's ja (a cross-locale leak). Returns null
 * only when neither source carries any text.
 */
export function resolveDescription(
  override: LocalizedTextOverride | null,
  template: LocalizedText | null,
  locale: Locale,
): string | null {
  return override?.[locale] ?? template?.[locale] ?? template?.en ?? null
}
