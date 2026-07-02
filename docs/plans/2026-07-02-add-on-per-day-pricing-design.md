# Per-day pricing for paid add-ons (#1071)

> Design doc. Rescopes #1071 (originally "ETC toll card add-on + indicative toll-cost transparency").
> Status: draft for review 2026-07-02. Branch `docs/add-on-per-day-pricing` off develop `376698a9`.
> Architect + two design-review passes folded in 2026-07-02 (verdicts: sound-with-changes / revise-light; no critical/high) — pricing-math optional-field fix, reworked slice boundaries (entity read-projection before capture; write path last), named #1315 conflict loci, the operator-alert email surface, the `StorefrontAddOnData` wire trio, the compose/derive round-trip test, and the `z.input`-vs-`z.infer` default caveat.

## Problem

Paid add-ons can only be charged as a single **flat per-booking** amount today.
That does not match how car rentals actually price optional equipment.

An industry survey (majors plus the Japan market) shows a clear split:

- Per-day is the dominant model for equipment and drivers: ETC card, snow/winter tires, additional driver, GPS/Wi-Fi.
- Flat/one-time exists too, and the **same item is priced both ways by different operators** (a child seat is "per trip" at Toyota, "per 24h" elsewhere).

This company is Osaka-based and the ETC card is definitively billed per rental day (about 330 to 550 yen/day).
So we need to charge some add-ons per day and keep charging others flat, chosen per add-on.

### Scope change from the original #1071

The original issue also wanted to **estimate/show toll costs**.
That is dropped.
We do not estimate or guess tolls.
We rent the ETC card and bill it per day; the tourist pays the actual tolls directly to the toll system.
This doc is only about the pricing cadence (flat vs per-day) of an add-on.

## What exists today (develop `376698a9`)

The add-on pricing path is small and already has a single choke point, which makes this a clean extension rather than a rewrite.

- **Schema** `packages/shared/src/db/add-on.ts` — `add_on_options.priceJpy` is `integer NOT NULL`, flat.
  The table comment (lines 27-32) states `priceJpy is a FLAT per-booking charge` and calls out that `insurance_options` is the per-day model.
- **Booking snapshot** `packages/shared/src/db/booking-types.ts:36-48` — `AddOnSnapshot = { addOnId, name, priceJpy, templateId?, nameLocale? }`, stored as `jsonb` on `bookings.addOnSnapshot`.
- **Pricing choke point** `packages/shared/src/lib/pricing.ts`:
  - `composeBookingTotal({ baseJpy, insurancePerDayJpy, days, addOns })` sums add-ons flat: `addOns.reduce((s, a) => s + a.priceJpy, 0)`.
    Insurance already multiplies by `days`; add-ons do not.
  - `deriveBaseJpy(...)` is the exact inverse (the confirmation receipt recovers the base line from the stored total) and also sums add-ons flat.
  - `rentalDays(startAt, endAt)` already computes whole-day count (`ceil`, min 1) and is already the `days` value passed into both functions.
  - The header comment records that both the API total and the web estimate compose through this one function on purpose (#855/#862/#867 desync guard).
- **Validators** `packages/shared/src/validators/add-on.ts` — `createAddOnSchema` is `{ templateId, descriptionOverride, priceJpy }` (the operator picks a platform template, not a free-text name, since catalog i18n slice 2); `updateAddOnSchema` edits `priceJpy` + `descriptionOverride`. Both carry a flat `priceJpy` only. `pricingModel` is added to this template-based schema, not a name-based one.
- **API** — `AddOnRepository` (Drizzle + InMemory), `services/add-on.ts`, `routes/add-ons.ts` read/write `priceJpy` unchanged; `services/booking-creation.ts` snapshots `{ addOnId, name, priceJpy }` at submit.
- **Web** — `vite/reservation/pricing.ts` `estimateReservation()` mirrors the server via `composeBookingTotal`; `AddOnsStep.tsx`, `ConfirmStep.tsx`, `bookings/BookingConfirmationView.tsx` render flat; operator `operator-add-ons/AddOnForm.tsx` + `AddOnRow.tsx` edit/show flat.

## The gap

There is no pricing-cadence discriminant anywhere in the stack.
Adding per-day means threading one flag from the operator's add-on row, through the booking snapshot, into the two pricing functions, and out to the validators, operator form, and renter-facing displays.

## Design

### Decisions

1. **Cadence is a per-add-on discriminant** `pricingModel: 'FLAT' | 'PER_DAY'`, stored on the **operator's** row (`add_on_options`), operator-chosen.
   Rationale: the survey shows operators price the same item differently, and the operator already sets `priceJpy` on this row, so cadence belongs next to it.
   `priceJpy` keeps meaning "the amount the operator entered"; `pricingModel` decides whether it is applied once or per day.
2. **Reuse `rentalDays()` and the `days` already in `composeBookingTotal`.**
   No new duration logic.
   Per-day line total is `priceJpy * days`, using the same `days` insurance already uses.
3. **The snapshot carries `pricingModel`.**
   So the receipt can show "550 yen x 3 days = 1,650 yen" and re-pricing on vehicle substitution stays correct.
   Legacy snapshots omit the field and are read as `'FLAT'` (backward-safe, matches today's behavior).
4. **Expand-only migration.**
   The new column is `NOT NULL DEFAULT 'FLAT'`, so every existing add-on and every in-flight booking is unchanged and there is zero behavior change until an operator opts an add-on into per-day.
5. **Defer the daily cap.**
   Majors often cap a per-day charge after N days; that is a follow-up, not MVP.
   Noted as an open question.

### Data model

- `packages/shared/src/enums.ts` — `export const ADD_ON_PRICING_MODELS = ['FLAT', 'PER_DAY'] as const` + `AddOnPricingModel` type (pins the #687 enum-sync test).
- `packages/shared/src/db/add-on.ts` — `addOnPricingModelEnum = pgEnum('add_on_pricing_model', ADD_ON_PRICING_MODELS)`; add `pricingModel: addOnPricingModelEnum('pricingModel').notNull().default('FLAT')` to `add_on_options`.
- `packages/shared/src/db/booking-types.ts` — `AddOnSnapshot` gains `pricingModel?: AddOnPricingModel` (optional; legacy omit -> `'FLAT'` on read).
- `packages/api/src/stores.ts` `AddOn` and `packages/shared/src/types/add-on.ts` `OperatorAddOnData` gain `pricingModel`.
- `packages/shared/src/db/seed-data/add-ons.ts` — add `pricingModel` to the `Pick` and seed the **ETC card as `PER_DAY`** (the motivating example), else with `DEFAULT 'FLAT'` the feature ships invisible in the demo.

### Pricing math (the money path)

- `composeBookingTotal` add-on element becomes `{ priceJpy: number; pricingModel?: AddOnPricingModel }` — the field is **optional** in the function param, exactly as it is on `AddOnSnapshot`.
  The default is applied inside the reduce: `(a.pricingModel ?? 'FLAT') === 'PER_DAY' ? a.priceJpy * days : a.priceJpy`.
  This is the load-bearing correction from the architect review: a *required* param would neither compile under `exactOptionalPropertyTypes` nor accept the existing `AddOnSnapshot[]` that the two live callers (`booking-lifecycle.ts` substitution re-price, `BookingConfirmationView.tsx` receipt) pass straight in.
- `deriveBaseJpy` takes the same optional element and mirrors the identical `?? 'FLAT'` subtraction so the inverse stays exact.
- Both remain pure (Functional Core / Imperative Shell), unit-tested once.
  This is the #855 desync guard: changing both together keeps the web estimate and the server total provably identical, and a legacy snapshot (field absent -> `'FLAT'`) recovers its base exactly.

### API

- `validators/add-on.ts` — `createAddOnSchema` gains `pricingModel: z.enum(ADD_ON_PRICING_MODELS).default('FLAT')`; `updateAddOnSchema` gains an optional `pricingModel` so cadence is editable.
  Caveat (design-review P2): the `.default()` protects the **runtime** API boundary (an untyped or 3rd-party POST omitting the field parses to `'FLAT'`), but `CreateAddOnInput = z.infer<typeof createAddOnSchema>` is the **output** type, where a defaulted field is **required** — so a typed caller that builds a `CreateAddOnInput` body without `pricingModel` (e.g. `AddAddOnDialog.tsx`) would fail tsc.
  Resolve by typing request DTOs as `z.input<typeof createAddOnSchema>` (the input type keeps the defaulted field optional); the operator dialog also passes `pricingModel` explicitly from the toggle in the enablement slice.
  (Contract drift: a defaulted Zod field guards inbound JSON, not the exported TS request type — check every `z.infer` consumer, not just `safeParse`.)
- `services/add-on.ts` — thread `pricingModel` through `create`, `update`, and the wire projection.
- `repositories/drizzle/add-on.ts` + `in-memory/add-on.ts` — read/write the new column.
- `services/booking-creation.ts` — capture `addOn.pricingModel` into the `AddOnSnapshot` at submit.

### Web

- Operator `AddOnForm.tsx` — a Flat / Per-day toggle (radio); `AddOnRow.tsx` — a cadence badge ("550 yen / day" vs "5,000 yen flat").
  The operator read schema `vite/operator-add-ons/api.ts` `addOnSchema` (`satisfies z.ZodType<OperatorAddOnData>`) and the API `wire-contract.test.ts` fence gain `pricingModel` too — tsc catches the type, the fence pins the wire.
- `vite/reservation/pricing.ts` — `ReservationEstimateInput.addOnPricesJpy: readonly number[]` becomes an object array carrying `pricingModel`, and the estimate applies `* days` for per-day.
  This is a breaking signature change: every caller and test updates, notably `ReservationWizard.tsx`.
  The add-on wire contract must carry `pricingModel` end-to-end, or the wizard estimate silently under-quotes a per-day add-on while the server charges more (the #855 desync).
  `ReservationAddOn` is only an alias of the shared `StorefrontAddOnData` (`packages/shared/src/types/storefront.ts`), so **three names change together**: the shared type, its producer `packages/api/src/services/storefront-detail.ts`, and the web parse `reservationAddOnSchema` (`vite/reservation/api.ts`, `satisfies z.ZodType<StorefrontAddOnData>`).
- **Every add-on display surface** renders the per-day line as `unit x N days` (missing one makes the itemized breakdown fail to sum to the stored total for a per-day booking):
  - `AddOnsStep.tsx` — a "/ day" suffix in the picker.
  - `ConfirmStep.tsx` — the confirm-step breakdown.
  - `bookings/BookingConfirmationView.tsx` — the renter receipt.
  - `operator-bookings/OperatorBookingDetail.tsx` — the operator's own booking detail (maps `addOnSnapshot`, prints `priceJpy` flat today).
  - `packages/api/src/services/email/templates/operator-alert.ts` — the operator new-booking **email**. The dispatcher passes `booking.addOnSnapshot` into the renderer at `notification-dispatcher.ts:509`, and the renderer prints each add-on at `priceJpy` (`operator-alert.ts:61`); a PER_DAY add-on must render `unit x N days`. The total row already uses `totalPriceJpy` (correct), so this is a misleading line item in an operator-facing money notification, not a wrong charge. The renderer already has `startAt/endAt` on `OperatorAlertData` to derive `days`. Needs a unit test.
  - `vite/bookings/api.ts` `addOnSnapshotSchema` — **correctness-critical, not cosmetic**: zod strips unknown keys, so without `pricingModel` here the field is dropped on every web read and all per-day displays plus `deriveBaseJpy` silently revert to FLAT. Good leverage: `operator-bookings/schema.ts` reuses this schema and `operatorBookingDetailSchema` extends `bookingDtoSchema`, so one edit covers the renter receipt, the operator detail, and the event timeline. (It also currently drifts from the `AddOnSnapshot` type by omitting `templateId?/nameLocale?`.)
- i18n en/ja/zh — per-day and flat labels, the "x N days" line, and the operator toggle labels.
  Parity is CI-checked (all three locales or the build fails).

## Slices (each mergeable, TDD)

Two ordering constraints drive the boundaries:

- **Write path last (architect HIGH-2).** A PER_DAY add-on must not become creatable until charge, base-derivation, and every display surface handle it. `composeBookingTotal` and `deriveBaseJpy` change together (a per-day charge with a flat derive mis-recovers the base), and no display or notification may lag creation.
- **Entity read-projection before snapshot capture (design-review P1).** The `booking-creation` snapshot capture reads `addOn.pricingModel` (`booking-creation.ts:675`), and the web estimate reads it off `StorefrontAddOnData` — both require the `AddOn` entity type (`stores.ts`) and the Drizzle read-projection (`repositories/drizzle/shared.ts` mapper) to carry the column first. So capture is **not** in slice 1; it rides with the write path once the projection exists.

1. **Money layer — `packages/shared` only (no per-day data can exist yet).** `ADD_ON_PRICING_MODELS` enum + type; the `pricingModel` column on `add_on_options` (`NOT NULL DEFAULT 'FLAT'`) + migration (`db:generate --name add_add_on_pricing_model` -> migrate -> verify); the optional `pricingModel?` on the `AddOnSnapshot` **type**; and **both** `composeBookingTotal` and `deriveBaseJpy` made per-day-aware (`?? 'FLAT'`). No API service/repo/route/capture changes; every existing row and booking is `FLAT`, so runtime behavior is unchanged.
   Pure-function pricing tests (per-day, mixed, legacy-omitted-field for both compose and derive, round-trip) + real-pg migration/enum-sync.
2. **Read + display path.** The `AddOn` entity read-projection (`stores.ts` type + `drizzle/shared.ts` mapper read the new column, default `FLAT`) and the storefront producer (`storefront-detail.ts`); the `StorefrontAddOnData` wire trio + `addOnSnapshotSchema`; the web estimate signature; and all six display surfaces render `unit x N days` (the four UI views + the `operator-alert` email + the schema parse). Still no per-day data exists (capture lands with enablement), so everything reads `FLAT` until then.
   Web estimate/server parity test + the operator-alert email unit test.
3. **Enablement (first slice a PER_DAY add-on can exist).** Validators (`pricingModel`, `z.input` request DTOs) + service create/update + routes + operator `AddOnForm` toggle + `AddOnRow` badge + operator wire schema + the `booking-creation` **snapshot capture** (now that the entity projection from slice 2 exists) + seed the ETC card `PER_DAY` + i18n toggle labels.
   The moment an operator can create (and a renter select) a per-day add-on, charge, derive, capture, and all displays already handle it — no reconciliation window.
   Integration tests: create a per-day add-on, snapshot carries the model, booking total equals `unit x days`, receipt reconciles.

## Test plan

- `pricing.test.ts` — `composeBookingTotal` per-day add-on equals `priceJpy * days`; mixed flat + per-day booking; `days = 1` minimum holds.
  For `deriveBaseJpy`: (a) a legacy case where the snapshot **omits** `pricingModel` recovers the base as FLAT (the receipt calls derive on exactly those rows), and (b) a round-trip `deriveBaseJpy(compose(perDay)) === base` — a one-sided change to only `compose` or only `derive` must fail the suite (this is what actually enforces "change both together").
- Validators — `pricingModel` is a constrained enum; create defaults to `FLAT`; update leaves it untouched when absent.
- Integration real-pg — a legacy-shaped insert defaults to `FLAT`; enum-sync (#687) covers the new type; snapshot round-trips the model.
- Web — estimate/server parity on a per-day booking; receipt renders "unit x N days".

## Risks and coordination

- **#1315 (catalog content i18n) is actively rewriting `add_on_options`** (expand-contract: `templateId` nullable through PR1, the `name` column dropped in slice 5, plus the partial-unique churn).
  The DDL is orthogonal (a new `NOT NULL DEFAULT` column vs a `DROP COLUMN name` and constraint churn) — no logical conflict — but there are three concrete code-level collision loci, so **sequence this after the in-flight #1315 PR**:
  - `packages/api/src/services/booking-creation.ts` snapshot literal `{ addOnId, name, priceJpy }` — we add `pricingModel`; #1315 slice 5 (dropping `name`) rewrites the same line. Guaranteed conflict.
  - `packages/web/src/vite/bookings/api.ts` `addOnSnapshotSchema` — we add `pricingModel`; #1315 slice 4 adds `templateId/nameLocale` to the same schema.
  - Migration + snapshot JSON — whoever merges **second** must **regenerate the migration against the post-#1315 snapshot** (not just renumber), per the CLAUDE.md 2026-04-17 out-of-order `_journal.json` gotcha.
- **Snapshot backward-compat** — legacy `AddOnSnapshot` rows lack `pricingModel`; reading them as `'FLAT'` preserves today's totals.
  A test pins this.
- **Money correctness** — `composeBookingTotal` and `deriveBaseJpy` are the only two choke points; missing one silently under- or over-charges (the #855 class of bug).
  Slice 1 changes both together behind the parity test.
- **Rounding** — per-day uses `rentalDays()` (ceil, min 1), the same unit insurance already bills in.
  Two cases to state plainly for the owner to accept:
  - A 26-hour rental bills 2 days.
  - A sub-day **hourly** rental (e.g. a 3-hour Osaka city trip) bills a **full day** for a per-day add-on even though the car itself is priced by the hour (`days: 0` in the base breakdown).
    So a 550 yen/day ETC card on a 3-hour rental charges 550 yen.
    This is consistent with how insurance already behaves on hourly rentals; the owner should confirm "minimum 1 day" is acceptable for per-day add-ons.

## Open questions (for review)

1. **Cadence ownership** — operator-chosen per add-on (this doc's default) vs platform-template-fixed (e.g. "ETC card is always per-day").
   Recommendation: operator-chosen, because the survey shows the same item is priced both ways.
2. **Template default hint** — should a platform template carry a suggested default cadence to prefill the operator form (ETC card -> PER_DAY)?
   Recommendation: nice-to-have, defer.
3. **Daily cap** — bill a per-day add-on for at most N days?
   Recommendation: follow-up, not MVP.
