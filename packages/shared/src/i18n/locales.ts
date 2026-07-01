/**
 * The single source of truth for the platform's supported locales, consumed by
 * the resolver, the template-completeness test, `customer.language`, and (via a
 * re-export) `SUPPORTED_TARGET_LANGUAGES`. Pure, zero runtime deps (edge-safe).
 *
 * Adding a 4th language is one entry here plus one optional line in
 * `localizedTextSchema` — no migration (the catalog JSONB bundles are schemaless
 * at the DB layer). This array is the vocabulary the resolver and completeness
 * test iterate, NOT a schema builder: a programmatic reduce over it would lose
 * the `en`-required precision, so `localizedTextSchema` stays a hand-written
 * literal.
 */
export const SUPPORTED_LOCALES = ['en', 'ja', 'zh'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
