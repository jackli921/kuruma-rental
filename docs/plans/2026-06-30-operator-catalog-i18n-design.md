# Operator Catalog Content i18n (add-ons + insurance)

> **Superseded 2026-07-07 by `docs/plans/2026-07-03-operator-custom-items-and-catalog-killswitch.md`.**
> That revision pivoted the operator catalog to **purely self-authored** names (`nameI18n`) instead of the platform-template picker this doc designs. The picker was retired for add-ons (slice 1) and insurance (slice 3), so the **template backfill/audit code and the once-planned PR2 `templateId` NOT-NULL flip / `name`-column drop were abandoned, and the backfill/audit deleted in slice 3c (#1437).** `templateId` plus the `insurance_templates`/`add_on_templates` tables stay as dormant, nullable scaffolding (never dropped - that would be destructive). Everything below is kept for design history; where it says a column becomes NOT NULL "in PR2 (slice 5)", that flip is not happening.

Status: design COMPLETE - v6 (round-6: owner P1/P2/P3 - keeper tiebreaker reads pre-migration `description` not the not-yet-populated `descriptionOverride`, a shared `DbOrTx` backfill handle type, and the corrected `requirePlatformRead`/`requirePlatformAdmin` guard names; all folded - see "## Round 6 review findings"). v5/v4 folded. Ready to implement slice 1.
Date: 2026-06-30.
Branch-off: implement off `develop` (post-#1109), where all `booking-creation.ts`/`storefronts.ts` cites resolve; the `docs/dashboard-buildout-plan` branch this was authored on is many commits behind and shows the pre-#1109 layout.
Epic: marketplace multi-tenant (#385). Realizes the deferred item in `docs/plans/2026-05-25-marketplace-mvp-proposal.md` §9 item 4 ("Per-operator content i18n ... future = machine-translate or operator multi-fill").
Reviewed: one architecture pass (folded C1, I1-I5, M1-M5), then a three-agent pass (architecture / implementation-contract / blast-radius), then a third detail round.
This revision folds all three passes: from round two - backfill orphans, wire-fence retirement, write-path locale seam, snapshot `nameLocale`, leading FK indexes, reject-not-coerce locale, PR split, template-completeness guard, non-read touchpoints; from round three - canonical `slugify`, normalized map-or-mint-or-merge backfill as an injectable fn (backfill-regions pattern), named `auditCatalogTemplates` gate, `$locale`-sourced booking snapshot, literal `localizedTextSchema`, deterministic seed ids, the completed wire-fence lockstep, duplicate-template UX, and the PR1 key-into-name write.

## Round 4 review findings (2026-07-01, folded)

A fresh architect pass (verdict SHIP-WITH-FIXES; no CRITICAL, no security/data-integrity hole) plus owner P1/P2 findings.
All are folded into the sections below; this ledger records each decision and its teaching note.

### P1

- **P1-a - split the override type from the template type.**
  `LocalizedText.en` is required (a template's identity), but `descriptionOverride` may hold only the authored locale (a `/ja` operator edit is `{ ja: "..." }`).
  One shared en-required type either rejects that valid edit or forces fake English into `en` (which then renders as everyone's fallback).
  Resolution: a SECOND type `LocalizedTextOverride` (partial, at least one key, NO en-required) for `descriptionOverride`; templates keep the en-required `LocalizedText`.
  Description resolution walks `override[locale]` -> `template.description[locale]` -> `template.description.en` (per-locale fall-through, so a ja-only override under a zh reader falls to the template's zh, never to the override's ja).

  Learn: Shared Shape, Different Invariant
  When two values look like the same object but have different lifecycle rules, one shared type becomes a trap.
  At scale, it either rejects valid data or forces fake fallback data.
  Heuristic: if requiredness differs, name a second type.

- **P1-b - drop the key-into-name bridge; keep `name` human-readable + add the template-unique index in PR1.**
  Writing the template `key` into the retained `name` column (the PR1 unique proxy) leaks `child_seat`-style keys into customer-visible booking snapshots frozen during the PR1 -> slice-4 window (snapshot population is deferred to slice 4).
  Resolution: do NOT write the key into `name`; on create write the resolved template `en` name, so snapshots freeze a real name.
  Add the partial `_active_template_unique(operatorId, templateId) WHERE status = 'ACTIVE'` in PR1 ALONGSIDE `_active_name_unique` (do NOT drop the name index in PR1 - superseded by round-5 P1: a partial unique on `templateId` does NOT catch duplicate NULLs, and old writers in the migration-before-code / rolling window still create `{ name, templateId: null }` rows, so the name index remains the only guard against active duplicates until every writer template-stamps `templateId`). Drop `_active_name_unique` with the `name` column in PR2.
  This enforces the true invariant from PR1 and retires the name-as-proxy contrivance (also resolves L5).

  Learn: Temporary Columns Are Contracts
  A retained column used as a bridge is still live product behavior.
  If one path treats it as a key and another treats it as display text, the bridge leaks.
  Heuristic: every temporary migration invariant needs all readers and writers named in the same slice.

### P2

- **P2-a - the picker exclusion needs an explicit target operator.**
  "Exclude templates the calling operator already offers" assumes an operator scope, but platform/legacy management callers have none (`routes/add-ons.ts:47` requires `operatorId` or `includeAll=true`).
  Resolution: the template picker endpoint takes an explicit target operator (mirroring the add-ons `operatorId`/`includeAll` pattern); an all-scope caller with no target gets the unfiltered platform list (no exclusion).
- **P2-b - the backfill must be transactional, not merely `templateId IS NULL`-guarded.**
  Selecting `WHERE templateId IS NULL` skips a row whose `templateId` was set before a crash interrupted its merge/archive/description-sync, so a rerun leaves the invariant half-applied.
  Resolution: run `backfillCatalogTemplates` in ONE transaction (or a per-operator transaction) so a crash rolls back the partial row; do not rely on nullness as the sole resume guard.
  (The prod-run CLI calls `runTx(tx => backfillCatalogTemplates(tx))` from `@kuruma/shared/db` - `getDb()` is neon-http and THROWS on interactive transactions, so `runTx` is the transaction seam; never write `getDb().transaction(...)`.)

### Architect fixes

- **H1 (HIGH) - test the seed SQL against the TS constant.**
  The curated set lives twice: raw `INSERT` SQL in the `--custom` migration and a TS constant (in-memory mirror, demo seed, completeness test), which cannot import each other.
  The completeness test iterates only the TS side, so a template missing/wrong in the SQL passes silently - the exact English-fallback bug this feature fixes.
  Resolution: treat the TS constant as the source; add an integration test that reads the seeded rows back post-migrate and asserts they equal the constant (ids, keys, all-locale bundles).

  Learn: Cross-artifact SSOT drift
  When one source of truth is expressed in two forms that cannot import each other (migration SQL vs a TS constant), they will silently diverge.
  A completeness test that iterates only one form proves nothing about the other.
  Heuristic: if a value lives in both code and SQL, add a test that reads the SQL back and asserts equality.

- **M1 - enumerate new `packages/shared` exports.**
  New subpaths (`i18n/locales`, `i18n/localized-text`, `i18n/slugify`, `db/backfill-catalog-templates`, the new DTO type modules) must be added to `packages/shared/package.json` `exports` in the slice that creates them, or `lint-export-drift` red-CIs (the #1120 lesson: `tsc` passes via path alias, the CI-only check catches it). Added as a lockstep item.
- **M2 - confirm the single snapshot site on live develop.**
  The "one snapshot site" claim was verified only against the working tree's pre-#1109 layout; re-confirm empirically on live `develop` at slice-4 start that `snapshotAndInsert` is a single site (else cover both SPECIFIC and CLASS_COMBO builders plus the seed twin).
- **M3 - demo seed rows need `templateId`; specify the JOIN kind.**
  `db:seed` rows carry no `templateId`, so once reads switch to the template JOIN they vanish (INNER) or null (LEFT) in every dev/CI env.
  Resolution: demo seed rows reference `tmpl_<slugify(name)>` directly in the SAME PR that flips reads; the read JOIN is LEFT with `name` fallback during the PR1 nullable window, tightenable to INNER after PR2's NOT NULL.
- **M4 - make the in-memory template store optional; wire it in `composition/repositories.ts`.**
  The dependency touches every `new InMemory*Repository()` (tests included), so make the constructor param OPTIONAL with a default seeded from the curated constant.
  Wire the real store in `packages/api/src/composition/repositories.ts` (NOT `index.ts`). Only the in-memory repos gain the dep - the Drizzle repos JOIN in SQL, so the tx-factory rebind (`repositories/drizzle/transaction.ts`) is unaffected.
- **M5 - declare `catalog_template_status` once.**
  Declare the `pgEnum` in one db module and import it into the sibling; two `pgEnum('catalog_template_status', ...)` calls emit two `CREATE TYPE`s and fail `db:generate`.
- **L1 - corrected drifted anchors:** `stores.ts` `AddOn` :373 / `InsuranceOption` :359; `OperatorAddOnsView.tsx` sort :32; `wire-contract.test.ts` full path `packages/api/src/wire-contract.test.ts` (the `Exact` fence + `toEqual` are intact).
- **L2 - keep the standalone FK index through PR2:** the PR2 composite `(operatorId, templateId)` leaves `templateId` trailing, which `lint-fk-indexes` will not count; do not drop `idx_*_templateId` as "redundant".

### Review environment caveat

Findings were verified against live files EXCEPT `booking-creation.ts`, read on a pre-#1109 tree (see M2).
The owner review did not run tests (document/architecture review); the "implement off `develop`" note (line 5) is intentional, and this authoring branch is behind.

## Round 5 review findings (2026-07-01, folded)

A plan re-review after v4. Verdict: close, but the PR1 constraint/drop ordering had to be fixed before slice 1 is safe. All four are folded above/below.

- **P1 (constraint ordering - a real bug in v4) - keep `_active_name_unique` through PR1.**
  v4 dropped `_active_name_unique` in PR1, but `templateId` is still nullable then, and a partial unique on `(operatorId, templateId) WHERE ACTIVE` does NOT catch duplicate NULLs.
  In the migration-before-code / rolling-deploy window the OLD writer still inserts `{ name, templateId: null }` (`routes/add-ons.ts:97`), so active duplicates would slip in.
  Resolution: PR1 adds `_active_template_unique` ALONGSIDE the retained `_active_name_unique`; the name index drops with the `name` column in PR2, only once no writer can produce a null-`templateId` row.

  Learn: Expand-Contract Means Old Code Still Exists
  A migration is not atomic with app replacement.
  If the old writer can run against the new schema, any removed constraint is a production behavior change.
  Heuristic: add the new invariant before removing the old one; remove old constraints only after old writers are impossible.

- **P2 (name the transaction seam) - the backfill CLI calls `runTx`, not `getDb().transaction`.**
  v4 said "direct transaction, not `runTx`", but `getDb()` is neon-http and cannot run interactive transactions (`db/index.ts:22`); `runTx` (`db/index.ts:54`) is the transaction-capable seam.
  Resolution: the CLI calls `runTx(tx => backfillCatalogTemplates(tx))`; `getDb().transaction(...)` throws at runtime.

  Learn: Name The Actual Boundary
  "Direct transaction" sounds obvious until the project has two DB handles with different capabilities.
  At scale, vague infra wording becomes a production-only failure.
  Heuristic: name the exact helper when driver capability matters.

- **P2 (slice/PR mapping) - split PR1a explicitly.**
  PR1a bundled the foundation (steps 1-2) with the dangerous row-columns/backfill/touchpoint half (steps 3-6), while the slice breakdown puts those in different slices.
  Resolution: the migration plan now labels steps 1-2 as the slice-1 foundation migration and steps 3-6 as the slice-2 add-ons-end-to-end migration, with an explicit "never ship 3-6 with slice 1."
- **P3 (accepted-limitation contradicts the resolver) - reword.**
  v4's "edited descriptions display single-language everywhere" contradicts `resolveDescription`, which falls a missing override locale through to the TEMPLATE's description for that locale.
  Resolution: the accepted limitation now states only the override TEXT is single-language until MT; readers in other locales get the template's localized description, degrading to `en` only when the template lacks that locale.

## Round 6 review findings (2026-07-01, folded)

A plan re-review after v5. Verdict: v5 well folded; three targeted fixes, all folded above.

- **P1 (backfill keeper tiebreaker read a not-yet-populated field) - read the pre-migration `description`.**
  v5 chose the duplicate keeper by "non-default `descriptionOverride`", but that column is populated LATER in the same backfill, so at keeper-selection every override is null: the tiebreaker always fell through to oldest and could archive the row whose old `description` was the customized one.
  Resolution: the keeper rule reads the pre-migration `description` column (differs from template `en` default = customized); if a loser held the only customization, migrate it onto the keeper before archiving.

  Learn: Backfill Order Defines Meaning
  Backfills often create the fields they later reason about.
  If the algorithm checks the new field before populating it, the "smart" branch never runs.
  Heuristic: keeper rules should read pre-migration facts, not post-migration fields that do not exist yet.

- **P2 (transaction handle is API surface) - type the backfill fn on a shared `DbOrTx`.**
  v5 correctly routed the CLI through `runTx(tx => backfillCatalogTemplates(tx))`, but still framed the fn as mirroring backfill-regions, whose signature takes the root `getDb()` `NeonHttpDb` handle. Inside `runTx` the callback receives a `TxHandle`, not that handle.
  Resolution: define/export a shared `DbOrTx` (`NeonHttpDb | TxHandle`, both currently module-private) once in `db/index.ts` and type `backfillCatalogTemplates(db: DbOrTx)` on it, so no call site casts.

  Learn: Transaction Handles Are API Surface
  A transaction is not just "a database" when the driver exposes different handle types.
  At scale, vague typing produces casts at every call site.
  Heuristic: if a helper accepts both root DB and tx DB, name that shared interface once.

- **P3 (guard name does not exist) - use `requirePlatformRead`/`requirePlatformAdmin`.**
  The deferred admin-CRUD non-goal referenced `requirePlatformMember`, which is absent repo-wide (verified). The live guards are `requirePlatformRead` (read-floor) and `requirePlatformAdmin` (write) at `auth/guards.ts:95,162`; AGENTS.md and MEMORY #1228 carry the stale name.
  Resolution: the non-goal now names the real guards. Follow-up worth filing: de-stale the `requirePlatformMember` reference in AGENTS.md.

## Problem

Operator catalog content (add-on and insurance option names and descriptions) is stored as single-language plain text and rendered verbatim as `{item.name}`.
Under a Chinese UI the page chrome translates correctly but the catalog item names show in English (`AddOnRow.tsx:22`, `InsuranceRow.tsx:23`, and the renter booking step `AddOnsStep.tsx:43`).
We are expanding to many operators serving en/ja/zh users, so catalog content must localize.

This is not a wiring bug.
Names/descriptions are user-generated data, not UI strings, and there is no localization mechanism for them today.

## Locked decisions (from brainstorming, do not relitigate)

1. Authoring model = "pick a curated template (supplies the translated name) + optionally edit the description".
   Operators do not type custom names going forward.
   Existing free-text names are bridged by the migration (see Migration: orphan reconciliation); a novel-add-on escape hatch is a filed follow-up.
2. Ship templates first (no external dependency, no cost, works immediately).
   Machine translation (MT) is deferred to a filed issue (needs a Google Translate API key the owner provisions).
3. Data model = one shared platform-owned template catalog, not per-operator copies.
4. Scope now = add-ons + insurance.
   Locations are deferred to the MT issue (proper nouns do not templatize).

## Non-goals / deferred (issues to file)

1. On-the-fly machine translation of edited descriptions and of location names.
   Reuses the existing `MessageTranslationService` cache pattern.
   Blocked on the owner provisioning `GOOGLE_TRANSLATE_API_KEY` and wiring it into `rotate-secrets.yml`.
2. Platform-admin UI to curate the template library (create/edit/translate templates; promote backfill-minted templates; merge synonyms).
   v1 seeds templates via migration only.
   When built, it mounts under `/admin/*` behind the structural platform read-floor `requirePlatformRead`, with curation WRITES gated by `requirePlatformAdmin` (`auth/guards.ts:95,162`; round-6 P3: `requirePlatformMember` does NOT exist in the repo - AGENTS.md / MEMORY #1228 carry a stale name; live guards are requirePlatformRead/Admin, #1164/#1228).
3. Locations i18n (folded into issue 1).
4. Re-resolving booking snapshots to the viewer's locale.
   We store `templateId` + `nameLocale` on the snapshot now (cheap, additive) so this is possible later without a schema change; booking views keep showing the frozen name until then.
5. "Request a template" operator escape hatch for a genuinely novel add-on.

## Architecture overview

A template is the shared, platform-owned, localized identity of a catalog item (its `key`, and its `name`/`description` in every language).
An operator's add-on/insurance row becomes an instance of a template: it references a `templateId` and carries only operator-set data (price, status, and an optional description override).

Reads resolve to the caller's locale in the API service layer and return plain strings, so the renter flow and every read path keep rendering `{item.name}` unchanged.
Only the operator management page changes (template picker + price + editable description).

## Shared foundation (`packages/shared`)

### Unified locale vocabulary (folds I2)

The set `['en','ja','zh']` is currently duplicated (`validators/translation.ts:3` `SUPPORTED_TARGET_LANGUAGES`, `validators/customer.ts` `customer.language`, and the web `$locale`).
Consolidate to one source:

```ts
// packages/shared/src/i18n/locales.ts  (pure, no runtime deps)
export const SUPPORTED_LOCALES = ['en', 'ja', 'zh'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
```

`SUPPORTED_TARGET_LANGUAGES` re-exports `SUPPORTED_LOCALES`, and `customer.language`'s `z.enum` switches to `z.enum(SUPPORTED_LOCALES)` (both, or the "one source" claim is only two-thirds done).
Adding a 4th language later is one `SUPPORTED_LOCALES` entry plus one optional line in the literal schema below, with no migration (the JSONB is schemaless at the DB layer).
`SUPPORTED_LOCALES` is the vocabulary the resolver and the completeness test iterate, not a schema builder: a programmatic reduce over the array would lose the `en`-required precision, so the schema stays a hand-written literal.

### `LocalizedText` type + resolver (folds I1, I2, M1)

Single source: the Zod schema is authored, the type is inferred from it (avoids two drifting definitions and `exactOptionalPropertyTypes` friction).

```ts
// `en` required, other locales optional, unknown keys rejected (.strict()),
// every present value .min(1) so an empty slot can never render blank (the
// resolver falls through only on absent/undefined). Hand-written literal, not
// a reduce over SUPPORTED_LOCALES, to keep the en-required precision.
export const localizedTextSchema = z
  .object({
    en: z.string().min(1),
    ja: z.string().min(1).optional(),
    zh: z.string().min(1).optional(),
  })
  .strict()
export type LocalizedText = z.infer<typeof localizedTextSchema>   // { en: string; ja?: string; zh?: string }

// P1-a: the override bundle has a DIFFERENT invariant - an operator may author
// in one locale only, so NO locale (not even en) is required, but at least one
// key must be present. A separate type, never reused as `LocalizedText`.
export const localizedTextOverrideSchema = z
  .object({
    en: z.string().min(1).optional(),
    ja: z.string().min(1).optional(),
    zh: z.string().min(1).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one locale required')
export type LocalizedTextOverride = z.infer<typeof localizedTextOverrideSchema> // { en?: string; ja?: string; zh?: string }

// The resolver for template name/description (en guaranteed present).
// Typechecks under noUncheckedIndexedAccess + exactOptionalPropertyTypes.
export function resolveLocalized(bundle: LocalizedText, locale: Locale): string {
  return bundle[locale] ?? bundle.en
}
// P1-a: operator-row description resolution walks the override for THIS locale,
// then the template's description for the same locale, then its en. The override
// may lack the requested locale (and en), so it never short-circuits the chain:
// a ja-only override under a zh reader falls to the template's zh, not to ja.
export function resolveDescription(
  override: LocalizedTextOverride | null,
  template: LocalizedText | null,
  locale: Locale,
): string | null {
  return override?.[locale] ?? template?.[locale] ?? template?.en ?? null
}
```

One schema + one inferred type + one resolver is the correct DRY axis (not a shared table; see below).

### Canonical slug (folds v3 backfill)

```ts
// packages/shared/src/i18n/slugify.ts (pure)
// casefold, keep unicode letters/digits, collapse other runs to a single '_'.
// UNICODE-AWARE (\p{L}\p{N}, u flag), NOT [a-z0-9]: this is a JP-market app,
// operators author Japanese names, and an ASCII-only class would strip every
// CJK char to '' - collapsing distinct offerings onto one empty key.
export function slugify(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')
  // Degenerate guard: an all-punctuation name still yields ''; key it by a
  // stable (deterministic) hash of the trimmed name so two such rows never
  // share a key. A shared key drives the map-or-mint-or-merge into ARCHIVING a
  // live, genuinely-distinct row (silent data loss), so '' must never collide.
  return slug || `x_${stableHash(name.trim())}`
}
```

The SAME `slugify` derives seed template `key`s AND matches/mints in backfill, so a seed `key` is exactly `slugify` of its canonical (English) name.
That equality is what lets the backfill collapse operator free-text variants (`"Child Seat"`, `"ETC  Card"`) onto the curated `child_seat` / `etc_card` templates instead of minting near-duplicates (see Migration plan step 4).
A Japanese free-text name keeps a distinct non-empty key and simply mints its own ARCHIVED template (it cannot match an English seed key without translation - that is the deferred MT job), so no data is ever lost.

### Template tables (folds M1 - keep two tables, DRY the code)

Two tables, mirroring the deliberate add_on/insurance parallelism (`add-on.ts:23` "Structure mirrors insurance_options exactly").
`add_on_templates` lives beside `addOnOptions` in `db/add-on.ts`; `insurance_templates` beside `insuranceOptions` in `db/pricing.ts`.
A shared `catalog_template_status` enum (`ACTIVE`/`ARCHIVED`), declared ONCE in one db module and imported into the sibling (M5: two `pgEnum('catalog_template_status', ...)` calls emit two `CREATE TYPE`s and fail `db:generate`).

```ts
export const addOnTemplates = pgTable('add_on_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull(),                                   // stable slug, e.g. 'child_seat'
  name: jsonb('name').$type<LocalizedText>().notNull(),
  description: jsonb('description').$type<LocalizedText>(),      // nullable
  status: catalogTemplateStatusEnum('status').notNull().default('ACTIVE'),
  createdAt, updatedAt,
}, (t) => [uniqueIndex('add_on_templates_key_unique').on(t.key)])
```

`insurance_templates` is identical (key + name + description bundles + status).
Insurance-specific fields (`dailyPriceJpy`, `deductibleJpy`) stay on the operator row - they are operator-set, not template content.
Templates are platform-global: no `operatorId`.

The `$defaultFn` random id is only for backfill-minted templates.
Seeded templates supply a DETERMINISTIC id (`tmpl_<key>`, e.g. `tmpl_child_seat`), never `crypto.randomUUID()`: seed re-runs are upserts and backfill maps onto seeded rows by a stable id, both of which break under a random id.

Status gates picker visibility only.
Resolution ignores status, so an archived-but-still-referenced template keeps rendering (M2).
This is also what makes backfill-minted templates (below) safe: minted `ARCHIVED`, they preserve the referencing operator's data and render, but never appear in any other operator's picker until a platform admin curates them.

### Operator row changes (folds I1, I3, I4, and review I-2 leading index)

On `add_on_options` and `insurance_options`:

- Add `templateId text` FK to the sibling template table, `onDelete: 'restrict'` (matches the `operators` FK convention).
  Nullable in PR1, `NOT NULL` in PR2.
- Add a LEADING FK-cover index in PR1: `index('idx_add_on_options_templateId').on(templateId)` (and `idx_insurance_options_templateId`).
  Required: `scripts/lint-fk-indexes.ts` counts a column as covered only if it is the leading column of an index; PR2's `(operatorId, templateId)` has `templateId` trailing, which does not count.
  Omitting this red-CIs on the first push.
- Add `descriptionOverride jsonb $type<LocalizedTextOverride>()`, nullable (P1-a: the override type, NOT `LocalizedText` - an operator may author one locale only).
  The operator's reworded description as a language-bag; only the authored locale is populated at first, and the deferred MT fills the remaining keys in place (zero future schema change - the point of I1).
- Keep `name`/`description` columns through PR1 (unused by reads), drop in PR2.
  P1-b: `create` writes the RESOLVED template `en` name into `name` (human-readable), NOT the slug key.
  A key in `name` would leak into customer-visible booking snapshots frozen in the PR1 -> slice-4 window (snapshot population is deferred to slice 4); a real name degrades gracefully.
- Unique index (P1-b + round-5 P1): PR1 ADDS the partial `*_active_template_unique` (`operatorId, templateId` WHERE `status='ACTIVE'`) ALONGSIDE the RETAINED `*_active_name_unique`.
  The template index enforces the real invariant ("an operator can't hold the same template twice while active", I3) for template-stamped rows, but a partial unique on `templateId` does NOT catch duplicate NULLs - so during the migration-before-code / rolling window, old writers creating `{ name, templateId: null }` rows are still guarded only by the name index. Keep BOTH through PR1; drop `*_active_name_unique` with the `name` column in PR2, once no writer can produce a null-`templateId` row. Expand-contract: add the new invariant before removing the old one.
  The migration carries a DDL comment clarifying that this index's `WHERE ACTIVE` predicate is the OPERATOR ROW status, not the template status (which gates picker visibility, a separate axis).

Resolution precedence for an operator row's description (P1-a): `resolveDescription(descriptionOverride, template.description, locale)` - per-locale fall-through (override[locale] -> template[locale] -> template.en), never the override's authored locale as a cross-locale fallback.

### Booking snapshot (folds I5 + review I-4/I-B/M-ii)

`AddOnSnapshot` and `InsuranceSnapshot` (`db/booking-types.ts:14,31`) gain, additive and optional (legacy jsonb omits them - read back as `undefined`, so type `templateId?: string | null` and `nameLocale?: Locale`, mirroring the `BOOKING_CANCELLED` precedent at `booking-types.ts:76-80`):

- `templateId` - so a future reader can re-resolve.
- `nameLocale` - the locale the frozen `name` was resolved in.

Freezing `nameLocale` alongside the name is what makes deferred re-resolution correct: a reader can show the frozen agreed name for the original renter locale and only re-resolve for other viewers, instead of silently rewriting a booking's add-on name after an operator edits a template.
The snapshot still freezes `name` as the robust human-readable fallback.

## API (`packages/api`)

### The locale input wire (folds C1 + review I-3 reject-not-coerce)

The public storefront reads take no locale today (`routes/storefronts.ts:99`, `services/storefront-detail.ts:150`), so the resolution seam has nothing to resolve against.

Add a `?locale=` query param to `GET /storefronts/:locationId/add-ons` and `GET /storefronts/:locationId/insurance-options`.
Zod-parse against `SUPPORTED_LOCALES`; an absent param defaults to `DEFAULT_LOCALE`; an unknown value (`?locale=xx`) is REJECTED with 400, not coerced.
Rejection matters because these responses are edge-cached via `cachePublic(c, CACHE_SECONDS)` and CF keys the cache on the full URL: coercing unknown values to a success would let `?locale=aaa`, `?locale=aab`, ... each mint a distinct cache entry serving identical `en` payload - a cache-flooding vector on the endpoint the repo calls "the most attractive scraping target" (`storefronts.ts:31`).
The 400 path is uncached (the route only calls `cachePublic` on `result.ok`).
There is no absent-locale cache-key canonicalization (`cachePublic` offers no such mechanism; CF keys on the full URL): the web always sends an explicit `?locale=`, and the bare-URL entry is only ever hit by a third party, harmlessly caching the `DEFAULT_LOCALE` payload once.
The reject-unknown-locale-with-400 (uncached) path is what actually closes the cache-flooding vector.

Pass locale as an explicit service argument, mirroring the messaging `translate(ctx, messageId, targetLanguage)` shape: `getAddOns(ctx, locationId, locale)`, `getInsuranceOptions(ctx, locationId, locale)`.
Do not put locale in `CallerContext` (public reads have no user).

The operator management reads (`GET /add-ons`, `GET /insurance-options`) take the same Zod-validated `?locale=` (default `DEFAULT_LOCALE`) to produce `resolvedName`; those responses are authed and not edge-cached, so the param is purely a resolution input.

### Booking-creation locale seam (folds review I-B)

Post-#1109 there is ONE snapshot-building site, the `snapshotAndInsert` tail: insurance reads `opt.name` (~`booking-creation.ts:648`) and add-on reads `addOn.name` (~`:680`); `seed-bookings.ts:123` is the seed twin.
(The four v2 cites `:383,416,652,678` predate #1109 and are stale.)
Once the repo returns bundles (and PR2 drops the column), these two reads must resolve `name` via the template.
The booking POST therefore needs a locale input: the wizard `$locale` the web already carries, threaded through the POST body, frozen as `nameLocale`.
NOT `customer.language`: it is not loaded at this site, a walk-in carries no language, and a stored preference is not the locale the renter actually browsed the storefront in.
A walk-in or operator-created booking with no request locale falls back to `DEFAULT_LOCALE`.
Threading is small: add `locale` to `createBookingSchema`, so it rides in `CreateBookingInput` and reaches the snapshot site via `args.input.locale` - no new `snapshotAndInsert` arg or `submitInTx` param, since that object already carries `input`.
That resolved string plus its `nameLocale` are what freeze onto the snapshot.
These are slice-4 work items, enumerated so they are planned, not discovered.

### Resolution location + repos (folds M3 + review in-memory source)

`resolveLocalized` (shared, pure) is called in the service layer - `storefront-detail.ts` for renters, the add-on/insurance service for operators.
Never in routes or repos.

Repos must not become N+1 on template joins (`findActiveByOperator` is single-query today, `repositories/drizzle/add-on.ts:71`).
The Drizzle repo JOINs the small global template table in one query and returns each row enriched with the template `key` + `name`/`description` bundles.
M3: the JOIN is LEFT with a `name`-column fallback during the PR1 nullable window (so demo/CI rows not yet carrying a `templateId` still render), tightenable to INNER after PR2's NOT NULL - and demo seed rows must reference `tmpl_<slugify(name)>` directly, in the same PR that flips reads, or they vanish/null.
The in-memory repo mirrors this from an injected in-memory template store (seeded from the same curated template constant the migration uses), so tests exercise the same shape.
M4: make the template-store constructor param OPTIONAL with a default seeded from the curated constant (so every existing `new InMemory*Repository()` in tests keeps compiling); wire the real store in `packages/api/src/composition/repositories.ts` (NOT `index.ts`). Only the in-memory repos gain the dep - the Drizzle repos JOIN in SQL, so the tx-factory rebind (`repositories/drizzle/transaction.ts`) is unaffected.

### DTOs and the wire-contract fence (folds M4 + review I-1/I-A - load-bearing)

Today the operator routes return the store row verbatim (`ok(c, row)`, `routes/add-ons.ts:60`), compile-pinned by `Exact<Jsonified<AddOn>, AddOnData>` in `wire-contract.test.ts:28-29`.
That fence only holds because the producer IS the row.
The operator DTO adds `resolvedName` (a computed, non-column field) and drops `name`, so the read can no longer be a verbatim row and `AddOnData` can no longer equal `Jsonified<AddOn>`.

Resolution: the operator add-on/insurance reads move off the `Jsonified` fence onto the hand-projected-service model the renter side already uses (`types/storefront.ts:14-21`: a projection that IS the DTO, pinned on the web with `satisfies z.ZodType<...>`).
This is a slice-2/3 work item with a fixed lockstep set (change together or typecheck breaks), in dependency order:

1. `db/add-on.ts` + `db/pricing.ts` - columns/migration.
2. `repositories/types.ts` - repo interfaces, including renaming `findActiveByOperatorAndName` -> `findActiveByOperatorAndTemplate`.
3. `stores.ts` rows - `AddOn` at `:373`, `InsuranceOption` at `:359` (L1: corrected from the doc's stale `:411`/`:397`).
4. `repositories/drizzle/shared.ts` - the mappers (`toAddOn`/`toInsuranceOption`), the column objects (`addOnOptionColumns`/`insuranceOptionColumns`), and the row types (`AddOnOptionRow`/`InsuranceOptionRow`).
5. In-memory repos - the mirror implementations plus their `.name` sort (`in-memory/add-on.ts:72` and the insurance twin).
6. Service projection layer - `services/add-on.ts` and `storefront-detail.ts` (where `resolveLocalized` runs and the DTO is shaped).
7. `types/add-on.ts` + `types/insurance-option.ts` - reshape the DTOs.
8. `packages/api/src/wire-contract.test.ts` (L1: full path; the bare filename in v3 was ambiguous) - the FULL edit: retire the two `Exact` type-lines for add-on/insurance (keep `feeContract`), the line-35 runtime `toEqual` assertion, and the now-unused imports.
9. Web `operator-add-ons/api.ts` + `operator-insurance/api.ts` `satisfies` schemas.
10. Three web components: `OperatorAddOnsView.tsx:32` sort (L1: corrected from `:35`), `EditAddOnDialog.tsx:58` prefill, and the archive dialog title (all read `.name` today).
11. Shared write validators - `validators/add-on.ts`, `validators/insurance-option.ts`.
12. `packages/shared/package.json` `exports` (M1) - add every new subpath (`i18n/*`, `db/backfill-catalog-templates`, the new DTO type modules) or `lint-export-drift` red-CIs (the #1120 lesson: `tsc` passes via path alias, the CI-only check catches it).

Three DTO shapes result:

- Renter (`StorefrontAddOnData`, unchanged shape): `name`/`description` are resolved plain strings for `?locale=`.
- Operator management (new `OperatorAddOnData` / `OperatorInsuranceData`): `resolvedName` (operator-UI locale, read-only), the raw `descriptionOverride` bundle (so the form can show/edit the authored-locale slot), `templateId`, price, status.
  The raw name bundle is out of scope here - only a future platform-admin translation editor needs it.
- Template picker (new): ACTIVE templates as `{ id, key, resolvedName }`.

### Template read + authz (folds M2 + review I-2 service ownership)

New operator-accessible reads `GET /add-on-templates` and `GET /insurance-templates` return ACTIVE templates for the picker.
Because they resolve locale to `resolvedName` (domain logic), they are NOT sanctioned thin-reads: each gets a real `AddOnTemplateService` + `AddOnTemplateRepository` (+ in-memory mirror) that owns the ACTIVE filter and resolution, so routes never import the repo.
The picker list EXCLUDES templates the calling operator already offers on an ACTIVE row, so the operator cannot pick a duplicate and hit the 409 (see Duplicate-template UX below); this is the one place the template read is scoped by an operator's own rows.
P2-a: that scope is an EXPLICIT target operator on the endpoint (mirroring the add-ons `operatorId`/`includeAll` pattern at `routes/add-ons.ts:47`), because platform/legacy management callers carry no operator context; an all-scope caller with no target gets the unfiltered platform list (no exclusion).
Template content is platform-global and non-sensitive, so any authenticated operator may read it.
`operatorReadScope` (`tenancy.ts:34`) scopes the operator's OWN add-on/insurance rows, NOT the templates themselves - templates have no `operatorId` and are not tenant data.
Template writes (curation) are platform-admin only and Deferred (v1 = seed-only).

## Migration plan (folds I4 + review C-1/C-2/I-C/I-E - split, orphan-safe, full touchpoints)

Split by domain to keep slices vertical (add-ons in slices 1-2, insurance in slice 3), not one horizontal schema PR.
Each PR runs `db:generate` -> `db:migrate` -> `db:verify` (3 green).
Note: `db:verify` checks schema/journal/DB sync only - it does NOT validate seed/backfill DML, so backfill correctness rests entirely on the dedicated tests below.
The template SEED goes in a `--custom` migration (danger-zone rule: never drop raw SQL into `drizzle/`).
The BACKFILL does NOT: it is the CLI-invoked injectable fn below (the backfill-regions model), run once against prod and audited before PR2.
Inlining the backfill DML into the migration would run it automatically in CI/local (which seed clean, so there is nothing to migrate) and break the "run against prod before PR2" gate story.
H1: the curated set is the SOURCE, held as a TS constant; the migration's seed `INSERT`s are DERIVED from it but cannot import it, so they can silently drift. Guard with an integration test that reads the seeded rows back post-migrate and asserts they equal the TS constant (ids, keys, all-locale bundles) - the template-completeness test iterates only the TS side and would miss a bad SQL row.

PR1a - ONE domain's migration but TWO slices/PRs (round-5 P2): steps 1-2 are the FOUNDATION migration (slice 1, additive, reversible - table + enum + seed); steps 3-6 are ADD-ONS END-TO-END (slice 2, the operationally dangerous half - columns, backfill, constraint + touchpoint switch). Never ship steps 3-6 with slice 1.

1. Create `add_on_templates` + the `catalog_template_status` enum.
2. Seed the template library with curated en/ja/zh translations for the current common items (from `db/seed-data/add-ons.ts`), each with a deterministic `tmpl_<key>` id and `key = slugify(canonical English name)`.
3. Add nullable `templateId` + `descriptionOverride` + the leading `idx_add_on_options_templateId` to `add_on_options`; ALSO add the partial `add_on_options_active_template_unique` (`operatorId, templateId` WHERE `status='ACTIVE'`) ALONGSIDE the RETAINED `add_on_options_active_name_unique` (round-5 P1: the partial index does not catch duplicate NULLs, so the name index must keep guarding rolling-window writers that still insert `templateId: null`; it drops with the `name` column in PR2).
4. Backfill (map-or-mint-or-merge, NORMALIZED, so no row is ever orphaned and no duplicate template is ever minted):
   - Resumable via a SINGLE transaction (P2-b), not nullness alone: it selects rows WHERE `templateId IS NULL`, but a crash after setting `templateId` yet before that row's merge/archive/description-sync would make a rerun SKIP a half-applied row. Wrap the whole run (or a per-operator run) in one transaction so a crash rolls back cleanly; the `templateId IS NULL` filter then only makes a fully-committed rerun a no-op (mirrors backfill-regions' region-less-only contract). The prod CLI calls `runTx(tx => backfillCatalogTemplates(tx))` (`@kuruma/shared/db`); `getDb()` is neon-http and throws on `db.transaction(...)`, so `runTx` - not `getDb()` - is the transaction seam.
   - Match each row's English `name` by `slugify(name)` against ALL existing keys - seed keys AND keys minted earlier in this same run, held in a live in-memory `Map<slug, templateId>` updated on each mint (not a per-row re-query).
     Because `slugify("Child Seat") === "child_seat"` and `slugify("ETC  Card") === "etc_card"` land on the curated keys, free-text variants map onto the curated template (gaining its ja/zh) rather than minting a near-duplicate that would `23505` on `add_on_templates_key_unique`.
   - Orphan reconciliation: for any `slugify(name)` with no existing key (operators author free text today - `validators/add-on.ts` `min(1).max(200)`, no allowlist), MINT an `ARCHIVED`, en-only template (`{ en: name }`, key = `slugify(name)`) and map to it; a later row with the same slug maps onto the just-minted template, not a second mint.
     Archived => data preserved and renders, but not offered in anyone's picker until a platform admin curates it (Deferred issue 2).
   - Intra-operator merge: if two ACTIVE rows for one operator normalize to the SAME `templateId`, keep one ACTIVE and ARCHIVE the rest IN THE BACKFILL itself (do not lean on the audit to merely detect it). Because `_active_template_unique` now exists from PR1 (P1-b), ARCHIVE the losers FIRST (dropping them from the `WHERE status='ACTIVE'` partial index) BEFORE assigning the shared `templateId` to the keeper, inside the P2-b transaction, or the second UPDATE trips `23505`.
     Keeper tiebreaker is deterministic (so re-runs are stable) and reads PRE-migration facts (round-6 P1): prefer the row whose existing `description` COLUMN differs from the template's `en` default (a real operator customization), else the oldest `createdAt`. Do NOT test `descriptionOverride` here - it is populated later in this same backfill (next bullet), so at keeper-selection every override is null and the "smart" branch would never fire. If a LOSER carried the only customization, migrate its `description` onto the keeper's `descriptionOverride` before archiving, so no edit is lost.
     This CAN happen - the old exact-name `_active_name_unique` permits case/punctuation variants (`"Child Seat"` and `"child  seat"`) that collapse to one slug - so the pre-v3 "cannot happen" claim was wrong and is deleted.
   - Migrate any `description` that differs from its template's `en` default into `descriptionOverride = { en: description }`; leave null where it equals the default.
   - Artifact shape (mirrors the REAL backfill-regions three-artifact pattern, NOT raw SQL): the DDL (tables, enum, columns, leading index) lives in the `--custom` drizzle migration, but the map-or-mint-or-merge DML is an injectable function `backfillCatalogTemplates(db: DbOrTx)` in `packages/shared/src/db/backfill-catalog-templates.ts` returning `{ mapped, minted, mergedDuplicates }`, plus a `scripts/` CLI and an integration test.
     Handle type (round-6 P2): unlike backfill-regions (which takes the root `getDb()` `NeonHttpDb` handle), this fn runs inside `runTx` (P2-b) so it receives a `TxHandle`. Define/export a shared `DbOrTx` type ONCE in `db/index.ts` (`NeonHttpDb | TxHandle` - both are currently module-private and must be exported) and type the fn (and any repos it calls) on it; otherwise every call site casts.
     (Reference artifacts to mirror: fn `packages/shared/src/db/backfill-regions.ts`, CLI `scripts/backfill-location-regions.ts`, test `packages/api/tests/integration/backfill-regions.test.ts`.)
5. Switch ALL add-on column touchpoints off `name`/`description` (not just display reads):
   - Reads/projections: `storefront-detail.ts`, operator service.
   - `ORDER BY asc(name)` (`drizzle/add-on.ts:39,76`) -> order by resolved/template name or `key`.
   - Uniqueness dup-check `findActiveByOperatorAndName` (`add-on.ts:64`) + its service callers + in-memory `assertActiveNameFree` -> renamed to `findActiveByOperatorAndTemplate` and re-expressed on `templateId`; its 409 copy changes from "an add-on with this name already exists" to "you already offer this add-on" (the picker excludes already-offered templates, so this 409 is now only a race-condition backstop).
   - Writes (`create`/`update`), `seed.ts` inserts, and the type-level `Pick<typeof addOnOptions.$inferInsert, 'id'|'operatorId'|'name'|'templateId'|'priceJpy'>` in `seed-data/add-ons.ts:11-14` (M3: seed rows now also carry a deterministic `tmpl_<key>` `templateId`; `name` stays the resolved en name through PR1).
   - Coupled tests: `tests/integration/*add-on*` name-unique `23505` asserts, `shared/tests/db/seed-data.test.ts` active-name asserts.
6. Keep `name`/`description` columns as a safety net.

PR1b (insurance): mirror PR1a for `insurance_options` + `insurance_templates` (same touchpoint list: `drizzle/insurance-option.ts:42,87`, `insurance-option.ts:73`, `tests/integration/insurance-options.test.ts:133,139`, `seed-data/insurance.ts:11-12`).

Pre-PR2 audit gate (both domains) = NAMED artifacts, not an ad-hoc query:

- A read-only fn `auditCatalogTemplates(db)` returning the OFFENDING ids (not bare counts, mirroring backfill-regions' `unassigned: string[]` so a nonzero gate names which rows): `{ nullTemplateIdRowIds, duplicateActiveTemplateGroups }`, plus a CLI the owner runs against PROD before merging PR2a/PR2b.
  Merge is gated on BOTH arrays being empty.
- `nullTemplateIdRowIds` = ids of rows with `templateId IS NULL` (map-or-mint-or-merge guarantees zero, but the gate proves it against prod-shaped data, not just seed).
- `duplicateActiveTemplateGroups` = `{ operatorId, templateId, rowIds }` for any operator holding two ACTIVE rows on one `templateId`.
  The backfill's intra-operator merge drives this empty; with P1-b, `_active_template_unique` already exists from PR1, so the backfill physically CANNOT commit a duplicate (it would `23505`) - the audit is then the independent proof, against prod-shaped data, that the merge ran and nothing is left before PR2's NOT NULL, not the thing that fixes it.
- A fixture integration test drives `auditCatalogTemplates` against prod-shaped rows (deliberate case/punctuation name variants) and asserts both arrays are empty after `backfillCatalogTemplates`.

PR2a / PR2b (after a confidence release, per domain):

1. Set `templateId NOT NULL`.
2. The `*_active_template_unique` index already exists from PR1 (P1-b) - nothing to swap; RETAIN the standalone `idx_*_templateId` (L2: the composite `(operatorId, templateId)` leaves `templateId` trailing, which `lint-fk-indexes` will not count, so do not drop it as redundant).
3. Drop the dead `name`/`description` columns (which also drops `*_active_name_unique`, retained through PR1 per round-5 P1, since it indexes `name`) - only after all writers template-stamp `templateId`, so no null-`templateId` active row can appear.

Nullable-first + kept columns keeps PR1 reversible; the only irreversible step (column drop) is gated behind PR2 and the audit.

## Guards / CI (folds review I-2/I-D)

- Leading `idx_*_templateId` in PR1 (else `lint-fk-indexes` fails); RETAIN it through PR2 (L2: the composite leaves `templateId` trailing and uncounted).
- `packages/shared/package.json` `exports` updated for every new subpath in the slice that adds it (M1) - else `lint-export-drift` red-CIs (the #1120 lesson; `tsc` passes via path alias).
- Seed SQL == TS constant (H1): an integration test reads the seeded template rows back post-migrate and asserts they equal the curated TS constant (ids/keys/all-locale bundles); the completeness test alone only checks the TS side.
- Template completeness: a `seed-data` test asserting every seeded template `name`/`description` bundle carries all `SUPPORTED_LOCALES` keys.
  `lint:i18n-parity` only guards `packages/web/messages/*.json`, so a template seeded missing `zh` would pass `localizedTextSchema` (only `en` required) and silently fall back to English - the exact bug this feature fixes. This test is the guard.
- The i18n merge gotcha (conflict resolution silently drops keys) applies to the new web message keys - verify en/ja/zh parity after merges.

## Web (`packages/web`)

- Renter reservation flow: `reservation/api.ts` passes the route's `$locale` as `?locale=` on the storefront add-ons/insurance fetch; `AddOnsStep.tsx` rendering is unchanged (now localized).
- Operator management (`vite/operator-add-ons`, `vite/operator-insurance`): the add/edit form becomes template picker + price + editable description (the authored-locale slot) + status - the free-text name input is removed.
  The list row switches from `{item.name}` to `resolvedName` (a real shape change, not a no-op - the row renders `{a.name}` today at `AddOnRow.tsx:22`).
- New client calls to fetch the ACTIVE template picker list.
- Booking snapshot web schemas (`vite/bookings/api.ts`, `operator-bookings/schema.ts`) add `templateId`/`nameLocale` as `.nullish()`/`.optional()` so legacy snapshot rows still `.parse()`.
- New i18n keys (picker label, "description in {language}", etc.) in en/ja/zh.

## Slice breakdown (vertical, add-ons before insurance)

1. Shared foundation: `SUPPORTED_LOCALES` unify (+ `customer.language`), `localizedTextSchema` + inferred `LocalizedText` + `resolveLocalized`, `localizedTextOverrideSchema` + `LocalizedTextOverride` + `resolveDescription` (P1-a), `slugify`, `add_on_templates` table + enum (declared once, M5) + curated seed, the additive `AddOnSnapshot`/`InsuranceSnapshot` type fields (population deferred to slice 4), migration PR1a tables/seed + the seed-SQL==TS-constant test (H1), and the new `packages/shared/package.json` `exports` entries (M1). Unit tests for the resolver + both schemas + template completeness.
2. Add-ons templated end-to-end (the big slice): operator row columns + backfill (map-or-mint-or-merge) + leading index, repo JOIN (Drizzle + in-memory), service resolution + the `?locale=` seam on storefront and operator reads, the wire-fence retirement + `OperatorAddOnData` projection, operator management UI (picker + price + description), renter flow locale pass, i18n. Demo: `/zh/manage/add-ons` and the renter add-on step show Chinese names.
3. Insurance templated end-to-end: mirror slice 2 for `insurance_options` + `insurance_templates` (PR1b).
4. Booking snapshot population: resolve `name` + freeze `templateId`/`nameLocale` at booking creation (the `booking-creation.ts` + `seed-bookings.ts` sites), web snapshot schema `.nullish()`.
5. Migration PR2a/PR2b (audit gate -> NOT NULL, index swap, drop columns) after a confidence release.

Slice 1 is already unblocked: only the literal `localizedTextSchema`, deterministic seed ids, and the template-completeness test touch it.
The backfill, locale-seam, and wire-fence work gate slices 2-5, not slice 1.

Deferred slices (filed as issues): MT population, platform-admin template CRUD, locations i18n, booking-view re-resolution, request-a-template flow.

## Testing strategy

- Resolver + `localizedTextSchema`: unit (fallback to `en`, missing-locale, `en`-required rejection, empty-string rejection, unknown-key rejection).
- Override (P1-a): `localizedTextOverrideSchema` accepts `{ ja }` alone, rejects `{}` (at-least-one-key), rejects unknown keys; `resolveDescription` precedence - override[locale] wins, ja-only override under a zh reader falls to the template's zh (NOT the override's ja), null override falls to the template, both-null returns null.
- Template completeness: every seeded bundle carries all `SUPPORTED_LOCALES`.
- Repos: `findActiveByOperator` returns template bundles in one query (mutation-resistant assert on joined shape); in-memory mirrors it from the injected template store.
- Services: locale resolution + override precedence (override beats template default; archived template still resolves); `?locale=` default, and unknown-locale 400.
- Migration/backfill: `db:verify` green; the map-or-mint-or-merge backfill leaves zero null `templateId` on NON-seed (prod-shaped) fixtures; `auditCatalogTemplates` reports both counts 0 (no operator holds two active rows per template) on case/punctuation-variant fixtures.
- Wire contracts: the retired `Exact` lines are gone; the new `OperatorAddOnData` projection is pinned on the web via `satisfies`.
- Booking snapshot: a legacy snapshot without `templateId`/`nameLocale` still parses (web + read mapper).
- Web: operator form renders picker + resolved name + editable description; renter step fetches with `?locale=` and renders the resolved name.

## Accepted limitations (explicit)

- An edited description's OVERRIDE text exists only in the operator's authored locale until MT fills the others; but a reader in another locale falls through to the TEMPLATE's description for that locale (`resolveDescription`, P1-a), not to the override's authored language - so it is NOT single-language everywhere (round-5 P3). Only a template lacking the reader's locale degrades to `en`.
- Backfill-minted templates are en-only and ARCHIVED until a platform admin curates them (Deferred issue 2); the referencing operator still sees their data, other operators do not see the minted template in their picker.
- Booking views show the frozen renter-locale name until Deferred issue 4 ships (now correctable because `nameLocale` is frozen).
- Operators cannot offer an add-on absent from the curated library until Deferred issue 5 (or a platform admin adds the template).
- A caller that omits `?locale=` (e.g. a 3rd-party integration) gets `DEFAULT_LOCALE` (English) - graceful degrade.
