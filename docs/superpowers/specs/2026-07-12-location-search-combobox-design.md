# Searchable location picker with locale-aware ordering

Design for issue #1543.
Status: Reviewed twice (architect + base-ui API review incorporated 2026-07-12).
Date: 2026-07-12.

## Context

The location search on the landing page and storefronts is a three-level cascade (prefecture -> city -> area), each level a native `<select>`.
Two problems:

1. **No search.** To pick "Osaka" an English visitor scrolls past ~30 prefectures; there is no type-to-filter.
2. **One order for every language.** Options render in the API's `sortOrder` sequence, which is the standard Japanese prefecture-code order (Hokkaido -> Aomori -> ... -> Okinawa). That is right for Japanese and Chinese users but hard to scan in English.

## Goals

- One reusable searchable picker (text search + dropdown list) used at every level of the cascade.
- Locale-aware ordering: English sorts A-Z by the English name; Japanese and Chinese keep the current prefecture-code order.
- Reuse the same control in the public search cascade and the operator location form.
- No new dependency, no schema or seed change.

## Non-goals

- No change to the `GET /regions` API contract or `sortOrder` data.
- No change to the region taxonomy, quick-pick chips (`namba`/`umeda`/`kix`/`kyoto`), or "Near me" geolocation.
- No fuzzy/typo-tolerant search; base-ui's built-in `Intl.Collator` `contains` match is enough for ~50 prefectures and small city/area lists.

## Locked decisions (from owner)

| Decision | Choice |
|----------|--------|
| Ordering | `en` A-Z by `nameEn`; `ja`/`zh` keep current `sortOrder` (prefecture-code) order |
| Control | `@base-ui/react` `Combobox` (already installed at `^1.3.0`), styled to match the existing `Select` wrapper |
| Scope | Public search cascade **and** operator location form |

## base-ui Combobox API (verified against installed 1.3.0)

Both `@base-ui/react/combobox` and `@base-ui/react/autocomplete` ship. **Combobox is the correct primitive** and the locked decision stands: `Autocomplete.Root` hardwires `selectionMode: 'none'` and its `value` is the *input string*, so it cannot hold a selected region id/slug. `Combobox.Root` (default `selectionMode: 'single'`) remembers the selection via `value` / `onValueChange`.

Facts that shape this design (from `node_modules/@base-ui/react/combobox/*.d.ts`):

- **The Root filters `items` internally** on the input value (default `autoComplete: 'list'`) using a built-in `Intl.Collator`-based `contains` match (`useFilter`), which is accent/case-insensitive and locale-correct out of the box. **Do not hand-roll a second filter** — it fights this and silently drops matches.
- A custom **`filter`** prop — signature `(itemValue, query, itemToString?) => boolean` (`AriaCombobox.d.ts:145`) — overrides the default match, so keyword matching (English `nameEn` under a `ja` UI) must be expressed *there*, in the single authoritative filter. The collator matcher is obtained from the **`Combobox.useFilter()`** hook (returns `{ contains, startsWith, endsWith }`) and closed over inside the widget; it is not a third argument to `filter`.
- `Combobox.List` children can be a render-prop `(item, index) => ReactNode`; `Combobox.Empty` requires `items` on the Root, auto-shows on no match, and announces politely to screen readers.
- `Item value` may be an object `{ value, label }`; base-ui derives display/submission strings from it (`itemToStringLabel` optional). A `null`-valued item is the idiomatic "Anywhere / All" row.
- `onValueChange` is `(value, eventDetails)` — not `(value)`.
- Parts: `Root, Label, Value, Input, InputGroup, Trigger, List, Empty, Status, Portal, Backdrop, Positioner, Popup, Arrow, Icon, Group, GroupLabel, Item, ItemIndicator, Clear` (+ `useFilter`).

## Current implementation (grounded)

- Public cascade: `packages/web/src/vite/regions/RegionPicker.tsx`. Filters `regions` by `type` + `parentId` + `status` and `.map()`s to `<option>` with no client sort (`:49-56`, `:109-146`). Value contract is a **slug** (`value: string | null`); clearing a deeper level emits the parent's slug, top level emits `null` (`emit`, `:61-67`). Consumed by `landing/SearchWidget.tsx` and `storefronts/StorefrontSearchForm.tsx`. Also renders quick-pick chips + "Near me" (`:150-179`).
- Operator form: `packages/web/src/vite/operator-locations/RegionCascade.tsx`. Same cascade shape, but value contract is a **region id**; a CITY can be terminal, and the area level is a conditional refinement that must keep a stale/INACTIVE current value visible (`showCurrentFallback`, `:82-89`, `:151-155`).
- Both derive the display name by locale with an identical `nameOf(region, locale)` helper (`RegionPicker.tsx:23-27`, `RegionCascade.tsx:20-24`).
- Control wrapper: `packages/web/src/components/ui/native-select.tsx` (plain styled `<select>`).
- API ordering: `packages/api/src/repositories/drizzle/region.ts:44` -> `.orderBy(asc(regions.sortOrder), asc(regions.nameEn))`.
- Data: `packages/shared/src/types/region.ts` -> `RegionNode` extends `RegionCandidate` and carries `nameEn`/`nameJa`/`nameZh`, `type`, `parentId`, `slug`, plus `sortOrder`/`assignable`/`status`. `sortOrder` is `NOT NULL default 0` and locally unique per parent (prefectures 1..47; cities/areas restart at 1 per parent). Trilingual names already in the DB.

## Design

### Overview

Two pure helpers (ordering + option-building) feed a presentational combobox that delegates *all* filtering to base-ui:

```
region-order.ts        (pure)  orderRegionsForLocale(nodes, locale) -> RegionNode[]
region-options.ts      (pure)  toRegionOptions(nodes, locale, opts)  -> ComboboxOption[]
components/ui/combobox  (view)  styled base-ui Combobox parts; owns ComboboxOption type
LocationCombobox        (view)  ComboboxOption[] + value/onChange + label + keyword filter
RegionPicker / RegionCascade   swap NativeSelect -> LocationCombobox, keep value contracts
```

`ComboboxOption` lives with the `components/ui/combobox` wrapper (a neutral module), so `LocationCombobox` is genuinely reusable beyond regions. The domain widgets keep owning their value semantics (slug vs id, empty-emits-parent, terminal CITY, stale-value fallback).

### Ordering (pure)

`packages/web/src/vite/regions/region-order.ts`:

```ts
const collators: Record<string, Intl.Collator> = {}
const collatorFor = (locale: string) =>
  (collators[locale] ??= new Intl.Collator(locale, { sensitivity: 'base', numeric: true }))

export function orderRegionsForLocale(
  nodes: readonly RegionNode[],
  locale: string,
): RegionNode[] {
  if (locale === 'en') {
    return [...nodes].sort((a, b) => collatorFor('en').compare(a.nameEn, b.nameEn))
  }
  // ja / zh: standard prefecture-code order; nameEn is the stable tiebreak (mirrors the
  // API's ORDER BY sortOrder, nameEn), though per-level sortOrder is already unique.
  return [...nodes].sort(
    (a, b) => a.sortOrder - b.sortOrder || collatorFor(locale).compare(a.nameEn, b.nameEn),
  )
}
```

Immutable (copy then sort). `ja`/`zh` re-sort by `sortOrder` explicitly rather than trusting upstream order, so the function is correct in isolation and mutation-resistant in tests. Each cascade level is a single `type`, so mixed-level lists never occur.

### Options (pure)

`packages/web/src/vite/regions/region-options.ts`:

```ts
export function toRegionOptions(
  nodes: readonly RegionNode[],
  locale: string,
): ComboboxOption[] {
  return orderRegionsForLocale(nodes, locale).map((r) => ({
    value: r.id,                          // caller maps id -> slug where needed
    label: nameOf(r, locale),
    keywords: locale === 'en' ? undefined : [r.nameEn], // English typing finds JP/ZH labels
  }))
}
```

`ComboboxOption` (defined by the ui wrapper): `{ value: string | null; label: string; keywords?: readonly string[] }`. The `null` value is reserved for the "Anywhere / All" row (below).

### Filtering — delegated to base-ui, keyword-aware

There is exactly one filter, passed to `Combobox.Root`, so the built-in pass never re-filters and drops keyword matches. The `filter` prop signature in 1.3.0 is `(itemValue, query, itemToString?) => boolean` (`AriaCombobox.d.ts:145`) — the third arg is `itemToString`, **not** a helpers bag. The collator matcher comes from the `Combobox.useFilter()` hook, closed over inside the widget:

```ts
// Inside LocationCombobox. `contains` is base-ui's Intl.Collator matcher (Filter.contains).
const { contains } = Combobox.useFilter({ sensitivity: 'base' })

// base-ui calls this per item with the item's object value. The "Anywhere / All" null
// row shows ONLY at an empty query, so a non-matching typed query empties the list and
// Combobox.Empty fires (Empty renders only when the whole list is empty — an always-on
// null row would suppress it forever).
const filter = (item: ComboboxOption, query: string) =>
  item.value === null
    ? query === ''
    : contains(item.label, query) || (item.keywords ?? []).some((k) => contains(k, query))
```

`contains` uses `Intl.Collator({ sensitivity: 'base' })`, so matching is accent/case-insensitive and, crucially, **kana-safe** — we do NOT normalize with NFKD. (NFKD would decompose voiced kana `が -> か + ﾞ` and strip the dakuten, collapsing voiced/unvoiced and producing false matches.) English "osa" matches Osaka via the `nameEn` keyword even in the `ja` UI; Japanese input substring-matches the kanji/kana label.

### `components/ui/combobox.tsx`

Thin wrapper over `@base-ui/react/combobox` parts (`Root / Input / InputGroup / Trigger / Positioner / Popup / List / Item / ItemIndicator / Empty / Clear`), styled with the same Tailwind tokens as `select.tsx` (border-input, popover surface, `focus-visible` ring). Must render inside `Combobox.Portal` + `Positioner className="isolate z-50"` (mirroring `select.tsx:72-79`) so the popup escapes the landing `SearchWidget` / storefront sticky/overflow containers. Input font is `text-base` (16px) on small screens to avoid iOS Safari focus-zoom (the `text-sm` used elsewhere triggers it). Exports the shadcn-shaped parts plus the `ComboboxOption` type.

**Do NOT use `Combobox.Label`.** In 1.3.0 it labels `Combobox.Trigger` only, and warns at runtime when `Combobox.Input` is the form control (`ComboboxLabel.js:50`). Our form control is `Combobox.Input`, so the visible label is the existing native `<Label htmlFor={id}>` (`@/components/ui/label`) tied to `Combobox.Input id={id}` — the same association the native selects use today.

### `LocationCombobox.tsx`

Presentational domain widget:

```ts
interface LocationComboboxProps {
  id: string
  label: string                 // visible <Label>, associated via id
  value: string | null
  onChange: (value: string | null) => void
  options: ComboboxOption[]     // does NOT include the "Anywhere" row; widget prepends it
  placeholderLabel: string      // the null-row label: "Anywhere" / "All cities" / "All areas"
  searchPlaceholder: string     // input placeholder, e.g. "Type to search"
  emptyText: string             // "No matches"
  disabled?: boolean
}
```

**Value bridge (string ↔ object).** The external contract is `value: string | null` / `onChange: (string | null) => void`, but the combobox item values are `ComboboxOption` **objects** (so the filter can read `label` + `keywords`). base-ui's `value` / `onValueChange` therefore carry `ComboboxOption | null`, not a string. The widget bridges at its own boundary, so consumers never see the object:

```ts
const nullRow: ComboboxOption = { value: null, label: placeholderLabel }
const items = [nullRow, ...options]
const selected = items.find((o) => o.value === value) ?? nullRow   // controlled -> object
// <Combobox.Root
//   items={items}
//   value={selected}
//   onValueChange={(opt: ComboboxOption | null) => onChange(opt?.value ?? null)}
//   isItemEqualToValue={(a, b) => a?.value === b?.value}   // object identity by .value
//   filter={filter} itemToStringLabel={(o) => o.label} ... >
```

- Renders `items` via the `List` render-prop; `Combobox.Empty` shows `emptyText` (fires because the null row is filtered out once a query is typed).
- At an empty query the null row is the first, keyboard-reachable list item; selecting it emits `onChange(null)` ("all of the parent" — a primary cascade interaction, so it stays a real row). While typing, "back to all" is via `Combobox.Clear` / Escape.
- `isItemEqualToValue` compares by `.value`, so a controlled value that is absent from the live list still resolves to its option (needed for the stale-area fallback below).
- `Combobox.Value` (with `itemToStringLabel` / the `{value,label}` shape) shows the selected label; `Combobox.Clear` also emits `null`.
- Keyboard/a11y from the primitive: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` on the active item; type to filter, Up/Down to move, Enter to select, Escape to close.

### Integration

**`RegionPicker.tsx`** — replace each `NativeSelect` with `LocationCombobox`. Options per level via `toRegionOptions(prefectures|cities|areas, locale)` (the `null` "Anywhere/All" row is added by the widget, so drop the manual `<option value="">`). The existing `emit(id, parent)` logic is preserved: the widget emits an option `value` (region id) or `null`, and `RegionPicker` maps id -> slug exactly as today (`slugOf`). Quick-pick chips and "Near me" untouched.

**Cascade reset must clear the child input.** When the prefecture changes, the child (city/area) combobox must not keep stale typed text. base-ui manages `inputValue` internally, so a bare `value` reset is not enough. Remedy: **key each child combobox on its parent id** (`key={chain.prefecture?.id ?? 'none'}`) so it remounts with a fresh input on parent change. Covered by a test.

**`RegionCascade.tsx`** — same swap; value stays a region id, so options map straight through. For the stale/INACTIVE current-area (`showCurrentFallback`), the widget's `selected` lookup must resolve to an option carrying the correct label even though that id is absent from the live `areas` list. Two concrete requirements:

1. **Label resolution (required).** Build a synthetic `ComboboxOption` from the already-resolved `selectedNode` (`RegionCascade.tsx:80`, which includes INACTIVE nodes) and prepend it to `items`. `isItemEqualToValue` then matches the controlled `value` to it, so `Combobox.Value` renders the current assignment's *label* instead of a misleading blank. This is what preserves today's guard.
2. **Popup visibility (not filtering).** The synthetic option only needs to be in `items` so it shows as the selected row when the popup opens at an empty query; it does **not** need to survive a typed query (a search that excludes it is fine — the selected label still shows in the input). So no special-casing in `filter` beyond the null-row rule.

Terminal-CITY and conditional-area rendering unchanged.

### i18n

Reuse existing per-level placeholders as the null-row label (`regionPicker.anywhere` / `allCities` / `allAreas`; `business.locations.form.region.placeholder`). Add three keys per locale (`en`/`ja`/`zh`): `search` (input placeholder), `noMatches` (empty text), `clear` (clear-button aria-label). Follow the i18n-parity guard (all keys in all three message files).

## Data flow

Unchanged. `GET /regions` still returns `sortOrder`-ordered trilingual nodes; ordering and filtering are client display concerns applied per active locale. No API, schema, seed, or migration change.

## Testing

- **Unit (pure)** `region-order.test.ts`: `en` -> A-Z by `nameEn` (assert exact sequence for a mixed fixture); `ja`/`zh` -> exact `sortOrder` sequence incl. the `nameEn` tiebreak; input array not mutated. `region-options.test.ts`: label picks the locale name; `nameEn` keyword present for `ja`/`zh`, absent for `en`.
- **Component** `LocationCombobox.test.tsx` (jsdom, through the real base-ui pipeline):
  - **`ja`-locale keyword test** — typing "osa" surfaces Osaka via the `nameEn` keyword (the only test that catches a broken filter).
  - Enter selects and calls `onChange` with the **id string** (not the option object — pins the value bridge); selecting the "Anywhere" row emits `null`; Clear emits `null`.
  - Empty query shows all options incl. the "Anywhere" row; a **non-matching typed query hides the "Anywhere" row and shows `emptyText`** (pins the null-row/`Empty` interaction).
  - a11y: `getByRole('combobox', { name })` resolves; ArrowDown advances `aria-activedescendant`.
- **Integration** (`RegionPicker` / `RegionCascade`):
  - Cascade resets child levels on parent change **and the child input text clears** (M2 key-remount).
  - Empty deeper level still emits the parent slug (`RegionPicker`).
  - Terminal CITY still emits the city id; INACTIVE-fallback test asserts the stale area's **label is displayed** in the input, not merely that the id round-trips (`RegionCascade`).
- **E2E** (Playwright, landing search): open prefecture picker, type "osa", pick Osaka, assert search state/URL reflects the Osaka slug. Assert `en` list alphabetical (first non-placeholder option = "Aichi") **and** a `ja` run keeps prefecture-code order (first = Hokkaido), pinning both halves of the locked ordering contract.

## Risks and tradeoffs

- **Mobile UX change.** A combobox replaces the OS-native `<select>` wheel picker: we gain search, lose the native affordance. Input is a standard text field (16px to avoid iOS zoom). Acceptable for a search-heavy flow; revisit if usability testing pushes back.
- **base-ui Combobox API.** Wrapper depends on the verified 1.3.0 parts/props above; pinned in Slice 1.
- **Filtering correctness.** Delegated to base-ui's collator `contains` (accent/case-insensitive, kana-safe). No NFKD normalization — that was rejected because it strips dakuten from voiced kana.
- **Zh sorting.** We deliberately do not collate Chinese alphabetically; `sortOrder` is the agreed order, so no pinyin/stroke collator is needed.

## Rollout (vertical slices)

1. **Primitive + pure core.** `components/ui/combobox.tsx`, `region-order.ts`, `region-options.ts` + unit/component tests. No user-visible change yet.
2. **Public search.** `LocationCombobox` + swap into `RegionPicker`; cascade-reset + integration + E2E. Ships the searchable, locale-ordered public picker.
3. **Operator form.** Swap into `RegionCascade` (port the stale-value fallback); integration tests. Retire `NativeSelect` usage here; keep the component only if other callers remain.

## File-by-file change list

| File | Change |
|------|--------|
| `packages/web/src/components/ui/combobox.tsx` | New styled base-ui Combobox wrapper; owns `ComboboxOption` |
| `packages/web/src/vite/regions/region-order.ts` | New pure `orderRegionsForLocale` |
| `packages/web/src/vite/regions/region-options.ts` | New pure `toRegionOptions` |
| `packages/web/src/vite/regions/LocationCombobox.tsx` | New domain combobox widget (keyword filter, null row) |
| `packages/web/src/vite/regions/RegionPicker.tsx` | Swap 3 `NativeSelect` -> `LocationCombobox`; child key-remount on parent change |
| `packages/web/src/vite/operator-locations/RegionCascade.tsx` | Swap `NativeSelect` -> `LocationCombobox`; port stale-value fallback into `items` |
| `packages/web/messages/{en,ja,zh}.json` | Add `search` / `noMatches` / `clear` keys |
| Tests | `region-order.test.ts`, `region-options.test.ts`, `LocationCombobox.test.tsx`, updated picker/cascade tests, one E2E |

## Open questions

1. Keep `NativeSelect` after Slice 3 (any remaining consumers), or delete it?
2. List-only selection (free-typed text can only *filter*, never become a value) — assumed yes.
3. Mobile: acceptable to drop the native picker everywhere, or keep `NativeSelect` under a small-screen breakpoint? (Design assumes combobox everywhere with a 16px input.)

## Appendix: architect review (2026-07-12) resolutions

| Finding | Resolution in this doc |
|---------|------------------------|
| H1 external filter fights base-ui's internal pass and kills the English-keyword feature | Single `filter` prop on `Combobox.Root`; no external `filterOptions` |
| H2 NFKD strips dakuten from voiced kana | Dropped NFKD; use base-ui collator `contains` (kana-safe) |
| M1 "Anywhere/All" needs a keyboard-selectable row | `null`-valued list item, `ComboboxOption.value: string \| null` |
| M2 cascade reset must clear child input | Key child combobox on parent id to remount |
| M3 stale INACTIVE fallback must survive filtering | Synthetic option always in `items`, filter keeps `value===value`, `isItemEqualToValue` |
| M4 test gaps (ja keyword, reset-clears, label shown, ja order, a11y) | Added to Testing |
| L1 widget not truly region-agnostic | `ComboboxOption` moved to the ui wrapper module |
| L2 iOS 16px | Input `text-base` on small screens |
| L3 ordering tiebreak | `nameEn` collator secondary key added |
| L4 portal not just z-50 | `Combobox.Portal` + `Positioner` required in the wrapper |
| L5 memo deps unstable | Note: memoize filtered lists too, or skip memoizing options |

### Second review round (2026-07-12) resolutions

| Finding | Resolution in this doc |
|---------|------------------------|
| P1 always-visible null row vs `Combobox.Empty` (never fires) | Null row shows only at empty query; a typed query filters it out so `Empty` fires on no real match |
| P1 `filter` signature is `(itemValue, query, itemToString?)`, not `{ contains }` | `contains` comes from `Combobox.useFilter()` closed over in the widget; filter takes `(item, query)` |
| P1 value contract `string \| null` vs object `items` | Explicit bridge: object items internally, `selected = items.find(o => o.value === value)`, `onValueChange(opt) => onChange(opt?.value ?? null)`, `isItemEqualToValue` by `.value` |
| P2 `Combobox.Label` labels the trigger, not the input | Dropped; use native `<Label htmlFor={id}>` tied to `Combobox.Input id={id}` |
| P2 stale-fallback "value === value" tautology | Restated: synthetic option built from `selectedNode`, prepended to `items` for label resolution via `isItemEqualToValue`; not required to survive query filtering |
