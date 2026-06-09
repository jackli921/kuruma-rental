# Slice 8 — Demo Seed, E2E Happy-Path & Polish (issue #390)

**Date:** 2026-06-02
**Status:** Draft v2 — refreshed 2026-06-04 against landed slices 3/4a/4b/4c (slices 5/6/7 still pending — hard dependencies for full seed + E2E); awaiting green light
**Parent epic:** #385
**Source of truth:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` (§6 row 8, §6.1 E2E gate, §6.2 scoping, §7 NFRs, §8.2, §9 item 9)
**Slice intent (proposal §6 row 8):** "3 operators × multi-location × ~40 vehicles across ACRISS codes, sample bookings, E2E happy-path test, i18n sweep. Demo: cold-start to Qiao demo."

---

## 0. What this slice is (and is not)

Slice 8 is the **integration / polish** slice — it ships no new domain entity. It (a) replaces the legacy flat vehicle seed with a credible marketplace dataset, (b) lands the **renter happy-path Playwright test** that is the §6.1 merge gate for this slice, (c) runs an **i18n parity + quality sweep**, (d) **verifies the §7 performance budgets**, and (e) produces a **demo runbook** for the Qiao/Du walkthrough.

**Acceptance (epic #385):** the demo shows *renter search → storefront result → vehicle selection → booking → confirmation notification visible in the operator portal*. That exact sentence is both the E2E assertion target (§5) and the runbook script (§8).

**Not in scope:** any schema change, any new repo/service/route, any new feature UI. If the seed needs a column that does not exist, that is a defect in slices 1–7, not a slice-8 task — treat it as an upstream bug, do not patch it here.

---

## 1. The hard dependency (read this first)

> **As of 2026-06-04 the seed's *operator / location / class / insurance / fee* substrate exists** (slices 3/4a/4b/4c landed on `marketplace-pivot`). **Slice 8 still cannot *fully* land until slices 5/6/7 merge.** The seed writes `operators`, `locations`, `vehicle_classes.acrissCode`, `vehicles` (operator/location/class FKs), `insurance_options`, `fee_schedules` — **all present today** — plus `bookings` (`requested_vehicle_id` / `assigned_vehicle_id` / `booking_code` / `insurance_option_id` / `insurance_snapshot` / `fee_snapshot`), `booking_events`, and `notification_log` — **none of which exist yet** (those columns/tables ship in slices 6/7). The `bookings` table on `marketplace-pivot` is still the *legacy* shape today (`vehicleId` + `classId` + `effectiveEndAt`, no `booking_code`, no snapshots; verified `schema.ts` 2026-06-04).

Status snapshot (2026-06-04):

| Provides | Slice / issue | State | Seed needs it for |
|---|---|---|---|
| `operators`, role enum (`OPERATOR_*` / `PLATFORM_ADMIN`), `CallerContext.operatorId` | #386 (slice 1) | **MERGED** | operator rows, scoped seed verification |
| `locations` table + `vehicles.pickupLocationId` (composite FK) | #387 (slice 2) | **MERGED** (PR #414, 2026-06-03) | location rows, vehicle→location FK |
| `vehicle_classes.acrissCode` + operator vehicle-class CRUD | #388 (slice 3) | **MERGED** (PR #418, `f4cd0bf`) | ACRISS distribution across ~40 vehicles |
| `insurance_options` per-operator CRUD | #404 (slice 4a) | **MERGED** (PR #421, `c439883`) | insurance seed rows |
| `fee_schedules` per-operator (optional per-class) CRUD | #405 (slice 4b) | **MERGED** (PR #424, `9e33403`) | fee seed rows |
| vehicle-level pricing (legacy class-level pricing **dropped**) | #406 (slice 4c) | **MERGED** (PR #427, `605d089`) | per-vehicle `dailyRateJpy`/`hourlyRateJpy` in the seed |
| storefront search read models | #391 (slice 5) | **OPEN** | E2E step 1–3 (search → storefront → vehicle) |
| `booking_events`, `bookings.*` marketplace cols, exclusion on `assigned_vehicle_id` | #392 (slice 6) | **OPEN** | sample bookings + E2E step 4 (book) |
| `EmailSender`, `notification_log`, operator notification badge | #393 (slice 7) | **OPEN** | E2E step 5 (operator-visible notification) |

**Entity shapes are cited from the proposal and *merged* code, not invented** — each seed builder consumes whatever the merged migration produced. Confirmed against `schema.ts` (2026-06-04): `insurance_options` (`dailyPriceJpy`, nullable `deductibleJpy`), `fee_schedules` (`feeType`/`unit`/`amountJpy`, optional `vehicleClassId` + composite-FK seal), `vehicle_classes.acrissCode` (no pricing columns — dropped by 4c), vehicle-level `dailyRateJpy`/`hourlyRateJpy`. Still *unconfirmed* (slices 5/6/7 unmerged): booking-code + selected-insurance snapshot shapes are cited from `docs/plans/2026-06-02-slice6-booking-event-log.md` §5–6 and will be re-checked against the merged migration at wire-up. Turnaround `defaultTurnaroundMinutes = 2880` is present on `locations` today.

### 1.1 What is wireable now vs blocked on 5/6/7 (de-risking)

As of 2026-06-04, slices 3/4a/4b/4c have merged, so the *operator → location → class → vehicle → insurance → fee* half of the seed can be **written against real schema now** (not just stub-drafted). Only the booking/event/notification half + the E2E real-render steps remain blocked on 5/6/7.

**Wireable today (real schema present):**
1. **Multi-operator seed (`operators` → `locations` → `vehicle_classes` → `vehicles` → `insurance_options` → `fee_schedules`).** Today's `seed.ts` seeds only **one** operator (Best Car Rental) and does **not** yet write `fee_schedules` at all (insurance is seeded; fees are not). Slice 8 expands to 3 operators and adds the fee-schedule seed. All target tables exist on `marketplace-pivot`.
2. **Vehicle-level pricing fixtures** — per-vehicle `dailyRateJpy`/`hourlyRateJpy` (slice 4c dropped class-level pricing; `vehicle_classes` carries no rate columns). Fixtures must price the *vehicle*, never the class.
3. **`seed-data/` typed fixtures** — operator/location/vehicle/ACRISS/insurance/fee arrays as `const`. The schema is stable, so these can import the real Drizzle types.
4. **Perf-budget harness** (§7) — build-size assertion + `@next/bundle-analyzer`, infra-only, independent of feature merges.

**Still blocked on 5/6/7:**
5. **Booking/event/notification seed builders** — `bookings` is still legacy-shaped today (no `booking_code` / `requested_vehicle_id` / `assigned_vehicle_id` / snapshots); `booking_events` and `notification_log` tables do not exist. These wire up after slices 6/7 merge.
6. **i18n sweep** (§6) — `lint:i18n-parity` passes today at **603 keys × en/ja/zh** across 11 namespaces (the `acriss` namespace landed with slice 3). The renter-facing key audit completes as slice 5/6/7 namespaces land.
7. **Playwright journey + mock-API extension** (§5) — `describe`/`test.step` skeleton with `test.fixme()` can be drafted now, but real assertions wait for slice 5/6 UI; the mock-API fixtures can be extended ahead of the UI.

**Net:** the seed substrate (items 1–3) can land now; the booking/E2E half collapses to ~1 day of integration once 6/7 are in.

---

## 2. Current state (grounded in merged code)

| Asset | Path | Slice-8 disposition |
|---|---|---|
| Marketplace seed (partial) | `packages/shared/src/db/seed.ts` | **Expanded.** Today (2026-06-04) seeds **one** operator (Best Car Rental, id `op_best_car_rental` from `constants.ts`) + its owner + platform-admin promotion + `SEED_LOCATIONS` + `SEED_CLASSES` (5 classes w/ `acrissCode`, idempotent on `slug` via `onConflictDoNothing` — see §3.6 / #420) + `SEED_INSURANCE_OPTIONS` + 16 `SEED_VEHICLES` with per-vehicle `dailyRateJpy`/`hourlyRateJpy` and `operatorId`/`classId` (composite FK). **Does NOT yet seed `fee_schedules`.** Slice 8 expands to 3 operators and adds the fee seed. |
| Legacy booking seed | `packages/shared/src/db/seed-bookings.ts` | **Rewritten.** Today writes `bookings` with `vehicleId` + `classId` + `effectiveEndAt` (legacy shape, unchanged by 3/4); marketplace schema (slice 6, **not yet merged**) replaces `vehicleId` with requested/assigned (§5.1) and adds `booking_code` + `booking_events`. Wire-up waits on slice 6. |
| `db:seed` / `db:seed-bookings` commands | `package.json:24-25` | Already point at the two seed scripts; ordering documented (§4). |
| Playwright config | `playwright.config.ts` | Reused. `testDir: ./e2e`, mock-API webServer on `:8787`, web dev on `:3001`, `screenshot: only-on-failure`, `trace: on-first-retry`. |
| Mock API | `e2e/mock-api.ts` | Path confirmed (2026-06-04). **Extended** with storefront-search / booking-submit / operator-notification fixtures (§5.3). |
| Existing E2E specs | `e2e/landing.spec.ts`, `e2e/browse.spec.ts` (#296 scaffold, #321 browse) | Kept; the new `marketplace-happy-path.spec.ts` is additive. Existing specs guard against regressions per §6.2. |
| i18n messages | `packages/web/messages/{en,ja,zh}.json` | **11 namespaces** (`common errors auth nav acriss catalog vehicles business messaging bookings landing` — `acriss` added by slice 3), **603 keys each, in parity today** (verified 2026-06-04). Sweep adds the slice-5/6/7 namespaces and re-verifies. |
| Parity lint | `scripts/lint-i18n-parity.ts` + `package.json:18` (`lint:i18n-parity`) | Machine half of the sweep (#375). Quality half is manual (§6). |
| `test:e2e` command | `package.json:11` (`bunx playwright test`) | The §6.1 gate runner. |

**Boundary note (AGENTS.md):** the seed lives in `@kuruma/shared` and writes through Drizzle directly — that is the one sanctioned non-API DB writer (it is a dev/ops script, not request-path code). The E2E mocks **only HTTP boundaries** (Resend, OAuth) per §6.2; it does not mock internal collaborators.

---

## 3. Demo seed design (proposal §9 item 9: the "credibility floor")

Target: **3 operators × 3 locations each × ~40 vehicles total across 6–8 ACRISS codes**, plus insurance, fees, and a spread of sample bookings/events. Built as typed data fixtures (`seed-data/`) consumed by idempotent builder functions.

### 3.1 Operators (3)

| # | Name | Slug (auto, §9 item 15) | Pre-auth URL (operators col, §9 item 2) | Locale of free-text |
|---|---|---|---|---|
| 1 | Best Car Rental | `best-car-rental` | configured Stripe pre-auth site | en/ja mix |
| 2 | Kansai Drive | `kansai-drive` | placeholder pre-auth URL | ja |
| 3 | Sakura Mobility | `sakura-mobility` | placeholder pre-auth URL | ja/en |

Each operator gets one `OPERATOR_OWNER` user (`owner@<slug>.example.test`) so the demo can log into each portal. Emails use `@example.test` (matches the existing `seed-bookings.ts` convention so cleanup greps cleanly). One `PLATFORM_ADMIN` seeded from `PLATFORM_ADMIN_EMAILS` (proposal §9 item 23).

### 3.2 Locations (3 per operator = 9)

Real Kansai pickup points for credibility: e.g. Best Car Rental → **Namba**, **Shin-Osaka**, **Kansai Airport (KIX)**; Kansai Drive → **Umeda**, **Tennoji**, **Kobe Sannomiya**; Sakura Mobility → **Kyoto Station**, **Nara**, **Osaka Castle area**. Each carries an address, operating hours, and `default_turnaround_minutes = 2880` (48h, proposal §2/§5.1) — one location overrides to a shorter buffer to demo configurability.

### 3.3 ACRISS classes (6–8 codes) + vehicle distribution (~40)

ACRISS first letter = category; the code lives on `vehicle_classes.acrissCode` (proposal §2, §10 item 13; column confirmed in `schema.ts` 2026-06-04). **Pricing is vehicle-level** — slice 4c (#406) dropped `vehicle_classes.dailyRateJpy`/`hourlyRateJpy` and their CHECK constraints; classes carry **no** rate columns now, so every seeded *vehicle* sets its own `dailyRateJpy`/`hourlyRateJpy` and a storefront's "from" price is `min(member vehicle rate)` (computed in slice 5). The table below is a *target* spread (8 codes); today's `seed.ts` ships 5 classes (`MCAR`/`CCAR`/`SCAR`/`SUVR`/`IVAR`) for one operator — slice 8 widens it. Distribution keeps every storefront searchable across classes:

| ACRISS | Class label (i18n key) | Example models | ~Count |
|---|---|---|---|
| `MCAR` | Mini (kei) | Honda N-BOX, Daihatsu Tanto, Suzuki Hustler | 7 |
| `ECAR` | Economy | Toyota Aqua, Honda Fit | 6 |
| `CCAR` | Compact | Toyota Yaris, Mazda 2 | 6 |
| `ICAR` | Intermediate | Toyota Corolla | 5 |
| `SCAR` | Standard / sedan | Toyota Camry | 4 |
| `IFAR` | Intermediate SUV | Mazda CX-5, Toyota RAV4, Suzuki Jimny | 6 |
| `FFAR` | Full-size SUV | Toyota Harrier | 3 |
| `PVAR` | Premium van (7+) | Toyota Alphard, Sienta, Honda Freed | 4 |

≈ **41 vehicles**, 8 ACRISS codes, spread across all 3 operators and 9 locations (no operator has a single-class fleet — each storefront must return ≥3 distinct class summaries so the search-result card is convincing). Vehicles reuse the existing seed's make/model/photos/seats but **add** `operatorId`, `classId` (composite FK), `pickupLocationId` (composite FK), per-vehicle `dailyRateJpy`/`hourlyRateJpy` (pricing lives on the vehicle now, §5.1), and `shakenExpiryDate`. Plates are realistic Kansai format (`なにわ 300 あ 12-34`). **Note:** there is no `vehicles.turnaround_minutes_override` column (see §11 risk #2) — demo the turnaround override via one location's `defaultTurnaroundMinutes` instead.

### 3.4 Insurance + fees (consume merged slice-4 schema)

Both tables exist on `marketplace-pivot` (4a `insurance_options` `c439883`, 4b `fee_schedules` `9e33403`). Column shapes verified in `schema.ts` 2026-06-04. Per proposal §2/§9 item 19:
- **Insurance** (`insurance_options`): each operator gets 2 rows — **Normal** (`deductibleJpy` 150000) and **Premium** (`deductibleJpy` 250000); operator-set `dailyPriceJpy` (e.g. 1500 / 2800), `status` `ACTIVE`. Already seeded for Best Car Rental today (`SEED_INSURANCE_OPTIONS`); slice 8 adds the other two operators.
- **Fee schedules** (`fee_schedules`): **not yet seeded by `seed.ts` today** — slice 8 adds this. Each operator gets the three fee types — `OVERTIME_HOURLY` (`unit: PER_HOUR`, e.g. 1000), `CLEANING_FLAT` (`unit: FLAT`, e.g. 5000), `NO_FUEL_FLAT` (`unit: FLAT`, e.g. 3000). At least one operator sets a per-class `OVERTIME_HOURLY` (e.g. higher for the SUV/van class) to demo the per-class path and exercise the `fee_schedules_operator_class_fk` composite-FK seal. Note: `feeType↔unit` coherence is enforced only in the Zod schema / `FeeScheduleService`, **not** by a DB CHECK — a direct seed write could persist an incoherent pair, so the seed must set coherent `(feeType, unit)` pairs explicitly.

### 3.5 Sample bookings + events (consume slice-6 schema — BLOCKED, not yet landed)

> **Blocked as of 2026-06-04:** slice 6 (#392) is OPEN. The `bookings` table is still the legacy shape (`vehicleId` / `classId` / `effectiveEndAt`); there is **no** `booking_code`, `requested_vehicle_id`, `assigned_vehicle_id`, `insurance_option_id`, `insurance_snapshot`, or `fee_snapshot` column, and **no** `booking_events` table. None of this subsection is wireable until slice 6 merges. Shapes below are cited from `docs/plans/2026-06-02-slice6-booking-event-log.md` and must be re-confirmed against the merged migration at wire-up.

A spread mirroring the current `seed-bookings.ts` time distribution (past COMPLETED, today ACTIVE, future CONFIRMED) but in marketplace shape:
- `requested_vehicle_id` = `assigned_vehicle_id` initially (proposal §2); **one** booking carries a `VEHICLE_SUBSTITUTED` event (old/new vehicle, reason) to demo the substitution audit trail (§9 item 25).
- each booking has a generated `booking_code` (8-char no-confusables base32), selected `insurance_option_id` + `insurance_snapshot`, and a `fee_snapshot jsonb` snapshotted from §3.4 fees (proposal §9 item 19).
- `booking_events` append-only: every booking gets an initial `BOOKING_CREATED` event; the demo "live" booking created during the E2E run produces a fresh event + `notification_log` row.
- demo renters reuse the `@example.test` personas (`Tanaka Yui`/ja, `Chen Wei`/zh, `Sarah Smith`/en, `Sato Hiroshi`/ja) so all three locales are represented.
- bookings respect the exclusion constraint on `assigned_vehicle_id` + 48h turnaround — seed times are chosen to avoid self-collision.

### 3.6 Seed structure & idempotency

```
packages/shared/src/db/
  seed-data/                # pure typed fixtures (draftable pre-merge, §1.1)
    operators.ts  locations.ts  vehicles.ts  insurance.ts  fees.ts  bookings.ts
  seed.ts                   # orchestrator: operators → locations → classes → vehicles → insurance → fees
  seed-bookings.ts          # bookings + events + notification_log (depends on seed.ts output)
```

Idempotency patterns vary by table in today's `seed.ts` (2026-06-04): vehicles are **delete-then-insert** (`db.delete(vehicles)`); classes/locations use **`onConflictDoNothing`** (slug / `(operatorId, name)`) to keep their `id`s stable as composite-FK targets; insurance uses a select-then-insert guard (the active-name uniqueness is a PARTIAL index `onConflict` can't target); `seed-bookings.ts` deletes by `@example.test` before insert. FK order matters — children deleted before parents, inserted parents-first.

> **Gotcha (#420): `onConflictDoNothing` is non-corrective.** Because `SEED_CLASSES` inserts with `onConflictDoNothing({ target: vehicleClasses.slug })`, **reseeding will NOT backfill or repair an existing class row** — e.g. a class seeded before slice 3 stays `acrissCode = NULL` after a reseed. Harmless for fresh demo DBs (the common path), but if slice 8 ever reseeds an older branch expecting ACRISS codes/prices to update, switch that insert to `onConflictDoUpdate` on `slug` (leave `id` untouched). Document the choice. The same caveat applies to any mutable demo field on classes/locations. **For slice 8, assume a fresh Neon branch off the merged pivot (proposal §5.1) — `onConflictDoNothing` is correct there.**

Run order per CLAUDE.md: `db:generate → db:migrate → db:seed → db:seed-bookings → db:verify`.

---

## 4. Seed execution & ordering

```bash
bun run db:migrate          # all slices 1-7 migrations applied on marketplace-pivot
bun run db:seed             # operators, locations, classes(ACRISS), vehicles, insurance, fees
bun run db:seed-bookings    # sample bookings + events + notification_log rows
bun run db:verify           # 3 green checks (schema/journal/DB sync)
```

`db:seed` and `db:seed-bookings` stay as separate `package.json` scripts (already wired: `:24-25`). Document a `db:seed:all` convenience script chaining both for the runbook.

---

## 5. E2E happy-path journey (the §6.1 merge gate)

New spec: `e2e/marketplace-happy-path.spec.ts`. **This is the required-green gate before slice 8 merge** (proposal §6.1: "renter search → storefront result → vehicle selection → book → confirmation email visible in operator portal"). Mutation-resistant assertions only — specific text/URL/role queries, never `toBeVisible()`-truthiness on a bare container.

### 5.1 Journey mapped to acceptance criteria

| Step | User action | Mutation-resistant assertion | Acceptance clause |
|---|---|---|---|
| 1. Search | Renter on `/en` fills pickup+return location, start+end datetime, class filter; clicks **Search** | URL → `/en/search?...`; result region has ≥1 storefront card; **`expect(cards.first()).toContainText('Best Car Rental')`** and the per-class summary text (`Compact ×N · from ¥X/day`) | "renter search → storefront result" |
| 2. Storefront result | Renter clicks the Best Car Rental Osaka card | URL → `/en/storefronts/best-car-rental/<location>`; heading `level:1` = operator+location name; available-vehicle list `toHaveCount(expected)` for the seeded date range | "storefront result" |
| 3. Vehicle selection | Renter picks the seeded `CCAR` Toyota Yaris | selection panel shows make/model/**license plate** + `dailyRateJpy` formatted as `¥8,000`; **insurance dropdown lists exactly the operator's 2 options** (Normal/Premium) | "vehicle selection" |
| 4. Booking | Renter selects Premium insurance, confirms dates, enters contact (email/name/phone/lang), submits | confirmation page URL contains `/booking/`; **booking-code matches `/^[2-9A-HJ-NP-Z]{8}$/`** (no-confusables alphabet, §9 item 3); page shows selected vehicle, selected Premium insurance, pre-auth handoff link (`href` = operator pre-auth URL), and a **"potential additional charges"** block listing the snapshotted overtime/cleaning/no-fuel fees | "vehicle selection → booking → confirmation" |
| 5. Operator-visible notification | Switch to operator session (Best Car Rental owner), open flat `/manage/bookings` | new booking row present with the **same booking-code** from step 4; **notification badge count incremented**; `notification_log` row rendered with `status: sent` (or `queued`) | "confirmation notification visible in operator portal" |

`test.step()` per row so the HTML report reads as the acceptance script. A failing step captures screenshot+trace (config already on). Run the renter journey on a mobile viewport variant too (proposal §8.2: iPhone/Android Chrome) — one extra project or `test.use({ viewport })` block.

### 5.2 What is mocked vs real (proposal §6.2)

- **Mocked (HTTP boundaries only):** Resend send (the mock-API records the call and flips `notification_log.status`), OAuth callback (a test session helper sets the renter/operator JWT). **Nothing internal is mocked.**
- **Real:** the entire web UI render, routing, search/booking/notification API contract via the mock-API fixtures, i18n message resolution. The mock-API mirrors the *real* response envelope (`{ success, data }` per `e2e/mock-api.ts:57-58`).

> Note: the current harness (`playwright.config.ts:42-49`) deliberately uses placeholder `DATABASE_URL` and routes to the mock-API — the spec never touches Postgres. Real-DB booking coverage is the **integration** suite (slice 6), not this E2E. This matches the existing two-track E2E strategy (`memory/project_e2e-strategy`).

### 5.3 Mock-API extension (`e2e/mock-api.ts`)

Add fixture endpoints mirroring the slice-5/6/7 real contracts:
- `GET /storefronts?from&to&...` → storefront cards with `class_summaries` (proposal §9 item 21).
- `GET /storefronts/:slug/:locationId/vehicles?from&to&class` → available vehicles for the range.
- `GET /insurance-options?operatorId=` → the operator's 2 options.
- `POST /bookings` → returns a fixed booking-code matching the no-confusables regex + `fee_snapshot`.
- `GET /bookings?operatorId=` (operator portal) → includes the just-created booking.
- `GET /notifications?operatorId=` → one `sent` row.

Fixtures stay frozen-timestamp (`FROZEN_TIMESTAMP`, mock-api.ts:7) for deterministic assertions.

---

## 6. i18n sweep checklist (#375 parity + quality)

Two halves, per `scripts/lint-i18n-parity.ts` header comment:

**(a) Machine — parity (automatable, CI-enforced):**
- [ ] `bun run lint:i18n-parity` green — all locales same key set (today, 2026-06-04: **603 keys × 3** across 11 namespaces).
- [ ] After each slice 5/6/7 namespace lands, re-run; conflict resolution silently drops keys (CLAUDE.md i18n gotcha) — verify post-merge.
- [ ] New marketplace namespaces present in **all three** files: `search`/`storefront` (slice 5), `bookings.confirmation` (slice 6), notification/email strings (slice 7). (The `acriss` namespace already landed with slice 3.)

**(b) Manual — quality (the #375 manual half the lint does NOT cover):**
- [ ] **Renter-facing en/ja/zh** (proposal §8.2 hard requirement): search form, storefront card, vehicle selection, booking form, confirmation page incl. selected insurance + "potential additional charges" block, confirmation email body — every value actually translated, not EN copied into JA/ZH.
- [ ] **Operator portal en/ja minimum** (zh optional per §8.2): locations, vehicles, insurance, fees, bookings list + notification badge.
- [ ] ACRISS class labels translated in all three (proposal §4 platform item 2). The `acriss` namespace shipped in slice 3 — verify it stayed in parity and covers every code the slice-8 seed uses.
- [ ] Outbound email templates (operator notification + renter confirmation) translated en/ja/zh (proposal §4 platform, §8.2 notification row).
- [ ] **Restart dev server after adding any new namespace** — `rm -rf packages/web/.next && bun run dev` (CLAUDE.md i18n gotcha: new namespaces need a restart).
- [ ] Operator-entered free-text is single-language per field by design (§9 item 4) — do **not** flag those as "missing translation".

---

## 7. Performance verification (proposal §7 / §8.2 budgets)

These NFRs are **explicitly verified in slice 8** (§7: "Next.js bundle already meets this; verify in slice 8"):

| Budget | Target | How verified in slice 8 |
|---|---|---|
| **First-load JS** | **< 500 KB** on renter pages (§7, §8.2) | `bun run --filter @kuruma/web build` → read Next.js per-route "First Load JS" for `/`, `/search`, `/storefronts/*`, `/booking/*`. Record numbers in the runbook. If any renter route exceeds, file a follow-up (do not fix here unless trivial). |
| **Search perf** | live availability < 500 ms p95 at MVP scale (3 ops × 40 vehicles) (§7, §8.2) | Hit the real search endpoint against the seeded `test`/dev branch; record p95 over ~50 runs. "Not enforced via SLO yet" (§7) — measure + record, do not gate. |
| **Responsive** | renter portal usable on iPhone + Android Chrome (§8.2) | E2E mobile-viewport variant (§5.1). |
| **Accessibility** | WCAG 2.1 AA — contrast, keyboard nav, aria on icon-only controls (§8.2) | Spot-audit renter happy-path pages (axe pass + keyboard-only run of the journey). |

Bundle measurement runs on the build output, independent of feature merges (§1.1 item 4) — can be wired early.

### 7.1 First-load JS budget — measured result + signed exception

**Measured (this slice):** shared first-load JS = **554.9 kB**, which is **54.9 kB over** the < 500 KB target. `scripts/check-bundle-size.ts` (`perf:bundle`) reads `rootMainFiles` + `polyfillFiles` from the Next 16 build-manifest (Turbopack emits no per-route First Load JS / app-build-manifest, so the shared baseline is the measurable figure).

**Root cause — Next.js 16 framework floor, not app code.** The two largest chunks both carry `react.dev/errors` markers (`react-dom` + `react` + `scheduler` ≈ 425 kB framework floor); the third (~110 kB) is the app shell. The heavy feature deps that would be cheap to split — `react-big-calendar`, `date-fns`, `recharts` — are **confirmed absent** from the shared set (they load per-route). There is no cheap code-split that brings the shared baseline under 500 kB; it is the framework floor.

**Disposition — signed exception (owner pre-authorized).** The 500 kB target is **not gated** in slice 8: the CI bundle-size step runs `continue-on-error` (advisory). The path to compliance is the **#378 Vite + TanStack Router migration**, which removes the Next.js framework floor — tracked there, not blocked here. Rationale: the overage is entirely framework, not feature regression, and re-architecting the bundler inside an integration/polish slice is out of scope.

> **Exception of record:** renter first-load JS baseline 554.9 kB (target < 500 kB) is accepted for the slice-8 interim milestone. Owner-signed; revisited when #378 lands. Re-measure after #378 and close the exception or re-budget.

---

## 8. Demo runbook (cold-start → Qiao/Du walkthrough)

A `docs/runbooks/` markdown (or runbook section) the operator follows live:

**Cold start**
1. `git fetch origin`
2. Use a fresh worktree or fast-forwarded local branch from `origin/marketplace-pivot`, then `bun install`.
3. Point `.env` + API `.dev.vars` at a fresh Neon branch off the fully merged pivot (proposal §5.2).
4. `bun run db:migrate` → `bun run db:seed` → `bun run db:seed-bookings` → `bun run db:verify` (3 green).
5. `bun run dev:api` and `bun run dev` (two terminals).

**Walkthrough script (mirrors the E2E journey, §5.1)**
1. **Renter search** — open renter portal, search Osaka pickup/return + dates + Compact class → storefront cards across all 3 operators with per-class summaries + min price.
2. **Storefront** — open *Best Car Rental — Namba* → available vehicles for the dates, grouped by ACRISS class.
3. **Select** — pick the Toyota Yaris (CCAR) → plate + price + insurance options shown.
4. **Book** — choose Premium insurance, confirm, enter contact → confirmation page with booking-code, selected insurance, pre-auth handoff link, and "potential additional charges".
5. **Operator view** — log in as the Best Car Rental owner → flat `/manage/bookings` shows the new booking + notification badge; show the operator-notification email content.
6. **Show range** — switch locale to ja and zh on the renter pages; switch to a second operator portal to show tenant isolation (operator 2 cannot see operator 1's bookings — proposal §6.2).

**Talking points:** multi-tenant isolation, ACRISS-standard taxonomy (Trip.com-ready), 48h turnaround, fee disclosure pattern (NicoNico/Hertz parity), substitution audit trail.

---

## 9. Tests & merge gate

| Layer | Slice-8 coverage |
|---|---|
| **Unit** | Seed builders: ACRISS distribution covers 6–8 codes; every storefront returns ≥3 class summaries; booking-code generator matches no-confusables regex; idempotent re-seed is a no-op (count stable). Pure-function tests on `seed-data/` fixtures. |
| **Integration** (Neon `test`/dev) | Run the full seed against a real branch; assert row counts (3 operators, 9 locations, ~41 vehicles, 6 insurance, 9+ fees, N bookings), FK integrity, exclusion-constraint non-violation, `db:verify` green. |
| **E2E (Playwright)** | `marketplace-happy-path.spec.ts` (§5) — **the required §6.1 gate**. Plus existing `landing`/`browse` specs stay green (regression guard, §6.2). |

**Merge gate (proposal §6.1, all green):** `bun run test` · `bun run lint` · `bun run --filter @kuruma/api lint:boundaries` · `bun run lint:modules` · `bun run lint:i18n-parity` · `bun run db:verify` · **`bun run test:e2e` (happy-path green — required for slice 8)** · code-reviewer + architect agents (`memory/feedback_review-before-ship`).

---

## 10. Execution order & worktree

```bash
# Branch from the remote pivot; local marketplace-pivot is known to lag.
git worktree add ../kuruma-demo-seed -b feature/390-demo-seed-e2e origin/marketplace-pivot
```

Within the worktree, TDD where applicable (seed builders + booking-code generator are pure → unit-test first; E2E journey is RED via `test.fixme` → GREEN as slice 5/6/7 UI lands):

1. **Now (3/4 merged):** wire the seed substrate — expand `seed.ts` to 3 operators (operators→locations→classes→vehicles→insurance→**fees**, the last currently unseeded); add `seed-data/` fixtures; integration row-count tests green. Plus draftable items: i18n checklist, Playwright skeleton + mock-API extension, perf harness.
2. After slice 5 merge: real renter search/storefront UI → E2E steps 1–3 wireable.
3. After slice 6 merge: wire `seed-bookings.ts` (bookings+events+`booking_code`+`fee_snapshot`); E2E step 4 green.
4. After slice 7 merge: `notification_log` seed + E2E step 5 green; full §6.1 gate green.
5. i18n sweep (§6) + perf verification (§7) + runbook (§8).
6. Rebase onto `origin/marketplace-pivot`, review, PR (`Closes #390`).

Always rebase, never force push (CLAUDE.md session protocol).

---

## 11. Resolved decisions / cross-slice risks

| # | Risk / question | Owner | Mitigation |
|---|---|---|---|
| 1 | **Slice 8 is gated on 5/6/7, all OPEN** (3/4a/4b/4c merged 2026-06-04). Seed substrate is wireable now; the booking/event/notification half + E2E real-render steps cannot land until 6/7 merge. | sequencing | §1.1 wireable-now work keeps it off the critical path; final wire-up ≈ 1 day post-merge. |
| 2 | Seed needs a column a slice didn't ship. **Confirmed present (2026-06-04):** `operators.preAuthHandoffUrl`, `locations.defaultTurnaroundMinutes` (default 2880). **NOT present:** `vehicles.turnaround_minutes_override` — proposal §9 item 20 calls it *optional* and it was not implemented; the §3.3 "override on one vehicle" demo currently has nowhere to live. Either drop that demo detail or use the per-location override (`locations.defaultTurnaroundMinutes`) instead. **Pending (slice 6):** `bookings.fee_snapshot`/`insurance_snapshot`/`booking_code`. | slices 2/6 | Treat any missing slice-6 column as a defect in slice 6; do **not** add schema in slice 8. Verify the booking columns at wire-up. |
| 3 | Concurrent seed migration is N/A (slice 8 adds no migration) but seed **assumes journal is clean** post-5/6/7. | this slice | `db:verify` before seeding; watch the out-of-order `when` trap (CLAUDE.md 2026-04-17) if slices rebased. |
| 4 | E2E mock-API contract drifts from real slice-5/6 API. | this slice | Mirror the `{ success, data }` envelope; cross-check fixture shapes against the merged route handlers at wire-up. The integration suite (slice 6) is the real-DB truth; E2E is render/flow. |
| 5 | i18n quality (vs parity) is manual and easy to skip. | this slice | §6(b) explicit checklist; lint catches parity, human catches EN-copied-into-JA. |
| 6 | First-load JS may exceed 500 KB once slice-5/6 renter pages land. | slices 5/6 | §7 measures at build; if over, file follow-up — the deploy-bridge (§8 of proposal) bundle concern is separate. |
| 7 | Booking-code regex must match the real generator alphabet exactly. | slice 6 | Verify the nanoid alphabet (`2-9A-HJ-NP-Z`, excludes `0 O 1 I l`) against slice-6's impl before asserting in E2E. |

---

## 12. Critical files

**New:** `e2e/marketplace-happy-path.spec.ts`, `packages/shared/src/db/seed-data/*.ts`, demo runbook (`docs/runbooks/2026-demo-runbook.md` or runbook section).
**Modified:** `packages/shared/src/db/seed.ts`, `packages/shared/src/db/seed-bookings.ts`, `e2e/mock-api.ts`, `package.json` (optional `db:seed:all`), `packages/web/messages/{en,ja,zh}.json` (sweep top-ups only — most keys ship in their owning slices).
**Read-only (verify, never modify):** `playwright.config.ts`, `scripts/lint-i18n-parity.ts`, `packages/shared/src/db/schema.ts`.
