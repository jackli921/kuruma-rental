# Add-on description machine-translation (auto-fill on save)

Status: DESIGN — architect-reviewed (SHIP-WITH-FIXES; all findings folded below), awaiting owner review.
Date: 2026-07-09.
Issue: #1318 (partial — the add-on-description half only; see Scope).
Epic: catalog content i18n (#1315). Realizes "Non-goals / deferred item 1" of the superseded
`docs/plans/2026-06-30-operator-catalog-i18n-design.md` ("On-the-fly machine translation of edited descriptions").
Branch: `feat/1318-addon-description-mt` off `develop`.

## Problem

An operator authors an add-on `descriptionOverride` in exactly one locale (the UI `$locale` at edit time —
`EditAddOnDialog.tsx` writes `setLocaleSlot(existing, locale, text)`).
A reader in another locale never sees a translation:

- Picked rows fall through to the platform template's description for that locale (`resolveDescription`).
- **Self-authored rows have no template floor** — `resolveOwnDescription` floors to *any* present locale, so a `ja`-only
  description shows a `zh` reader the Japanese text (readable, but the wrong language).

The infra to fix this is live: `GOOGLE_TRANSLATE_API_KEY` is set on the beta API Worker and drift-guarded in
`deploy.yml` (#1290/#1297), and the DI-swappable `TranslationProvider` port + `GoogleTranslationProvider` already back
`MessageTranslationService`. This slice reuses that provider to auto-fill the missing description locales on save.

## Scope

**In:** machine-translate an **add-on** `descriptionOverride` into the remaining `SUPPORTED_LOCALES` when the operator
saves, so every reader sees the description in their own language.

**Out (stay deferred under #1318):**

- **Insurance descriptions.** `insurance_options.descriptionOverride` exists as a column but is *unwired* — no operator
  UI authors it, `insurance-resolve.ts` resolves only the name, and no service writes it. Translating a field nothing
  authors or reads is premature; it waits until insurance description authoring itself exists.
- **Location names.** `locations.name` is plain `text` with no i18n bundle at all — needs a schema change (a separate,
  larger slice).

## Locked decisions (from brainstorming — do not relitigate)

1. **Auto, silent on save.** No operator review step, mirroring how chat messages auto-translate. MT is best-effort: the
   authored locale is always saved; a translation failure degrades gracefully and never fails the operator's save.
2. **Model B — single source locale, refreshed every save.** The operator has one authoring locale; on every save MT
   re-derives all *other* locales from it, overwriting. Translations are always current.
   Accepted limitation: MT owns the non-source locales — operators cannot hand-tune an individual locale, and editing in
   a different UI locale re-bases the source to that locale.
3. **Author-time write, not read-time.** The filled bag is persisted into `descriptionOverride`; reads stay pure. This
   matters because the renter storefront read is public and edge-cached — a DB write inside a cached GET is unsafe.
4. **The source locale is the existing `?locale=` param, not a new field.** The route already parses `?locale=` on
   create/update and passes it to the service; the operator authors in that same UI locale, so it doubles as the Model-B
   source locale. No new wire field, no validator change.

## Architecture

### New collaborator: `DescriptionTranslator` (`packages/api/src/services/description-translation.ts`)

```ts
export interface DescriptionTranslator {
  // Build the full override bag: source verbatim + each other SUPPORTED_LOCALE via MT.
  // Best-effort — a locale whose provider call throws is omitted (reader falls back).
  fill(sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride>
}
```

- The real impl wraps a `TranslationProvider`, translating `sourceText` from `sourceLocale` into each other locale.
  The non-source calls run in parallel (`Promise.allSettled`); a rejected one is dropped, not fatal.
- **Bounded deadline (LOW-6).** The provider is `TIMEOUT_MS=3000 × MAX_ATTEMPTS=2` ≈ 6s per locale
  (`google-translation-provider.ts:6-7`); run the locales in parallel and cap the whole `fill` so a slow provider can't
  make an operator's save feel hung. Keep it synchronous (not `waitUntil`-deferred) — the list refetch reads-after-write.
- **No silent no-op default (MEDIUM-3).** The `AddOnService` translator param is REQUIRED, not defaulted. A no-op default
  fails to *degraded output* (source-only, no error) if the composition root forgets to wire the real translator — unlike
  the `isSharedCatalogEnabled` default whose `true` IS the intended prod value. A test-only exported fake is passed
  explicitly by the ~7 existing `new AddOnService(...)` sites, and a wired-test pins the real injection (see Testing).
- **Dev-stub note (NIT-7).** With no key in dev the factory stub returns `[<locale>] <text>`
  (`translation-provider-factory.ts:21`). Because this slice PERSISTS the fill (unlike message translation's read-time
  use), a dev/staging DB accumulates literal `[ja] …` descriptions. Harmless, but expected.

### `AddOnService` changes (`packages/api/src/services/add-on.ts`)

- Constructor gains a **required** `descriptionTranslator: DescriptionTranslator` (4th param, no default — MEDIUM-3).
- `create` resolves the persisted bag **once** before dispatching to `createFromTemplate` / `createSelfAuthored`.
- `update` resolves the bag when `data.descriptionOverride` is being set, with a **skip-on-unchanged** guard, gated on
  `existing.templateId`.

**MT applies to SELF-AUTHORED rows only (HIGH-1).** A picked row's description already falls through to the platform
template's human-curated per-locale text via `resolveDescription` (`add-on-resolve.ts:28`); MT-filling its override would
SHADOW that curated text with machine output in every locale (`override?.[locale]` wins first) — "fixing" a row the
Problem section admits has no bug. So MT runs only when the row is self-authored (`nameI18n` set on create;
`existing.templateId === null` on update). Picked rows store `descriptionOverride` verbatim.

**Never coerce a non-empty bag to null (HIGH-2).** The source slot is `descriptionOverride[locale]` and `?locale=`
defaults to `en` (`helpers.ts:252`); the API is source-agnostic (Trip.com hits these same routes), so a caller sending
`{descriptionOverride:{ja:"…"}}` without `?locale=ja` must not lose the `ja` text. MT runs only when a real source slot
is present; otherwise the caller's bag is stored unchanged.

**Bag resolution rule** (`sourceLocale = locale`, the request param; `sourceText = descriptionOverride[locale]`):

| Incoming `descriptionOverride` | Result |
|---|---|
| `undefined` (update — field not touched) | leave existing bag untouched, no MT |
| explicit `null` | store `null` (cleared), no MT |
| picked row (`templateId` set / no `nameI18n`) | store the bag **verbatim**, no MT (HIGH-1) |
| self-authored, `sourceText` present & non-empty, and (create OR changed OR bag incomplete) | `fill(locale, sourceText)` |
| self-authored, `sourceText` unchanged vs stored row & bag complete (update) | keep existing bag, no MT |
| self-authored but `sourceText` absent/empty (e.g. caller omitted `?locale=`) | store the bag **verbatim**, no MT (HIGH-2 — no coercion to null) |

### Composition (`packages/api/src/index.ts`) — MEDIUM-5

`AddOnService` is constructed at `index.ts:498`, and `translationProvider = createTranslationProvider()` already exists at
`index.ts:214`. Build the real `DescriptionTranslator` over that provider and inject it into `AddOnService`. (The earlier
draft named `composition/services.ts`, which holds only `resolve*` helpers and constructs neither — optionally add a
`resolveDescriptionTranslator()` helper there for consistency, but the wiring edit is `index.ts`.) The prod sentinel
provider throws per-locale, so a best-effort `fill` drops every locale and stores the source alone — no working
translations ship silently on a secret drift.

### Web (`packages/web/src/vite/operator-add-ons`)

- `api.ts`: thread the route `$locale` into `createAddOn` / `updateAddOn` and append `&locale=${locale}` to the POST/PATCH
  URLs (also fixes a latent bug where write responses resolve to `en` regardless of the operator's locale).
- `AddAddOnDialog.tsx` / `EditAddOnDialog.tsx`: pass `$locale` to those calls. Description input handling is otherwise
  unchanged — the operator still edits one locale slot; the server now fills the rest.

**No migration. No read-DTO / wire-fence change.** `descriptionOverride` already exists and is already resolved.

## Data flow

```
operator edits description in /ja  ->  PATCH /add-ons/:id?operatorId=..&locale=ja  body { descriptionOverride: { ja: "…" } }
  route: locale = ja                 ->  AddOnService.update(ctx, id, data, locale=ja)
  service: sourceText = data.descriptionOverride.ja
           translator.fill('ja', sourceText)  ->  { ja: "…", en: MT(ja->en), zh: MT(ja->zh) }
           repo.update({ descriptionOverride: <full bag> })
renter views storefront in /zh       ->  resolveOwnDescription(bag, 'zh')  ->  the MT zh text
```

This is the SELF-AUTHORED path (the only one MT touches — HIGH-1). A picked row's override is stored verbatim and its
other locales resolve through the curated template description, unchanged.

## Error handling

- Provider throws for a locale -> that locale is omitted from the bag (best-effort). The operator's save still succeeds;
  a `zh` reader falls back through `resolveOwnDescription` exactly as before this slice. No 5xx, no partial-write.
- The prod sentinel provider (no key) throws for every locale -> the bag holds only the source slot. Correct fail-safe.
- **Capture the failure (MEDIUM-4).** Request observability only reports `>=500` / `>2s` (`observability/middleware.ts`),
  so a fully-silent drop is a blind spot — a `GOOGLE_TRANSLATE_API_KEY` drift would degrade every add-on save to
  source-only with zero signal. On a dropped locale, `console.error` (parity with `message-translation.ts:46`) AND
  `Sentry.captureException`. Silent-drop the reader fallback, never the operator/ops signal.

## Testing strategy (TDD, vertical)

- **`DescriptionTranslator` unit** (fake provider): source stored verbatim; each other locale filled; a provider that
  throws for `zh` yields a bag with `en` + source but no `zh`; empty/whitespace source -> handled by the service, not here.
- **`AddOnService` unit** (fake provider):
  - create with a `ja` source fills `en`/`zh` (mutation-resistant: assert the exact translated values from the fake).
  - update with unchanged source text and a complete bag makes **zero** provider calls (spy on the fake).
  - update that only changes `priceJpy` does not re-translate.
  - a provider failure still persists the source slot and returns `ok: true`.
  - **picked-row (HIGH-1)**: a `templateId` create/update with a one-locale override stores it VERBATIM — zero provider
    calls, template floor intact.
  - **source-agnostic caller (HIGH-2)**: a self-authored write with a non-empty bag but no `?locale=` stores the bag
    verbatim (no coercion to null, no data loss).
- **Wired-test (MEDIUM-3)** — mirror `tests/routes/shared-catalog-killswitch-wired.test.ts`: assert `createApp`'s
  `AddOnService` gets the REAL `DescriptionTranslator`, so a forgotten injection fails CI.
- **Web**: a test that `updateAddOn` / `createAddOn` include `&locale=<locale>` in the request URL.

## Architect review (2026-07-09, folded)

Independent architecture pass. Verdict SHIP-WITH-FIXES; no CRITICAL. Code assumptions verified accurate except the two
noted. All folded into the sections above.

- **HIGH-1 — picked-row MT shadows curated template text.** MT was applied to both create branches; for a picked row that
  shadows the human-curated per-locale template description with machine output. Fix: gate MT on self-authored only
  (`nameI18n` / `existing.templateId === null`); picked rows store verbatim.
- **HIGH-2 — `?locale=` overload silently drops content.** Source slot `descriptionOverride[locale]` with `?locale=`
  defaulting to `en` meant a source-agnostic caller (Trip.com) sending a `ja`-only bag without `?locale=ja` would have its
  text coerced to null — a data-loss regression vs today. Fix: MT only when a real source slot is present; otherwise store
  the caller's bag verbatim.
- **MEDIUM-3 — no-op default translator.** Silent zero-translation if the composition root forgets to wire the real one.
  Fix: required constructor param + a wired-test pinning the real injection.
- **MEDIUM-4 — silent MT failure = observability blind spot.** Request obs only reports 5xx/slow. Fix: `console.error` +
  `Sentry.captureException` on a dropped locale.
- **MEDIUM-5 — wrong wiring file named.** `AddOnService` is built in `index.ts:498`, not `composition/services.ts`. Fixed.
- **LOW-6 — bound the in-request MT deadline** (~6s/locale worst case). Folded into DescriptionTranslator.
- **NIT-7 — dev stub persists `[ja] …` junk** in dev/staging DBs. Noted.
- **NIT-8 — divergence from the MessageTranslationService content-keyed cache is justified** (mutable content + Model B
  overwrite). No change.

## Accepted limitations (explicit)

- MT owns the non-source locales; operators cannot hand-tune a single locale's translation.
- Editing the description under a different UI locale re-bases the source to that locale (overwriting the prior source's
  MT — including a previously hand-authored slot, since there is no per-slot provenance).
- Machine-translation quality is provider-grade; there is no human review before it reaches renters (locked decision 1).

## Out-of-scope follow-ups (do not do here)

- Insurance + location description/name MT (the rest of #1318).
- Per-slot provenance so a hand-authored locale survives a source re-base.
