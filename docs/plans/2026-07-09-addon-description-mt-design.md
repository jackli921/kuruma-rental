# Add-on description machine-translation (auto-fill on save)

Status: DESIGN — awaiting owner review.
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
- A **no-op default** (`{ fill: (l, t) => ({ [l]: t }) }`) is exported so every existing `new AddOnService(...)` in
  tests keeps compiling — the same defaulted-dependency pattern the constructor already uses for `isSharedCatalogEnabled`.

### `AddOnService` changes (`packages/api/src/services/add-on.ts`)

- Constructor gains `descriptionTranslator: DescriptionTranslator = noopDescriptionTranslator` (4th param, defaulted).
- `create` resolves the persisted bag **once** before dispatching to `createFromTemplate` / `createSelfAuthored`, so both
  branches store the translated bag instead of the raw `data.descriptionOverride`.
- `update` resolves the bag when `data.descriptionOverride` is being set, with a **skip-on-unchanged** guard.

**Bag resolution rule** (`sourceLocale = locale`, the request param):

| Incoming `descriptionOverride` | Result |
|---|---|
| `undefined` (update only — field not touched) | leave existing bag untouched, no MT |
| `null`, or source slot empty/absent | store `null` (cleared), no MT |
| source text unchanged vs the stored row **and** bag already complete (update) | keep the existing bag, no MT |
| otherwise | `fill(sourceLocale, sourceText)` where `sourceText = descriptionOverride[sourceLocale]` |

"Source slot" = `descriptionOverride[locale]`. Any other keys the client sent are ignored — Model B rebuilds them.

### Composition (`packages/api/src/composition/services.ts`)

Wire the real `DescriptionTranslator` over `createTranslationProvider()` (Google when the key is set; the prod sentinel
throws on use, so a best-effort `fill` simply drops every locale and stores the source alone — no working translations
ship silently on a secret drift) and inject it into `AddOnService`.

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

## Error handling

- Provider throws for a locale -> that locale is omitted from the bag (best-effort). The operator's save still succeeds;
  a `zh` reader falls back through `resolveOwnDescription` exactly as before this slice. No 5xx, no partial-write.
- The prod sentinel provider (no key) throws for every locale -> the bag holds only the source slot. Correct fail-safe.

## Testing strategy (TDD, vertical)

- **`DescriptionTranslator` unit** (fake provider): source stored verbatim; each other locale filled; a provider that
  throws for `zh` yields a bag with `en` + source but no `zh`; empty/whitespace source -> handled by the service, not here.
- **`AddOnService` unit** (fake provider):
  - create with a `ja` source fills `en`/`zh` (mutation-resistant: assert the exact translated values from the fake).
  - update with unchanged source text and a complete bag makes **zero** provider calls (spy on the fake).
  - update that only changes `priceJpy` does not re-translate.
  - a provider failure still persists the source slot and returns `ok: true`.
- **Web**: a test that `updateAddOn` / `createAddOn` include `&locale=<locale>` in the request URL.

## Accepted limitations (explicit)

- MT owns the non-source locales; operators cannot hand-tune a single locale's translation.
- Editing the description under a different UI locale re-bases the source to that locale (overwriting the prior source's
  MT — including a previously hand-authored slot, since there is no per-slot provenance).
- Machine-translation quality is provider-grade; there is no human review before it reaches renters (locked decision 1).

## Out-of-scope follow-ups (do not do here)

- Insurance + location description/name MT (the rest of #1318).
- Per-slot provenance so a hand-authored locale survives a source re-base.
