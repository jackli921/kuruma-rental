# Slice 8 — Demo Seed, E2E Happy-Path & Polish (issue #390)

**Date:** 2026-06-02 · **Revised:** 2026-06-07 (re-scoped to interim core-path milestone)
**Status:** Green-lit as the **INTERIM core-path integration milestone** — NOT the final expanded-MVP demo.
**Parent epic:** #385 · **Issue:** #390 (interim). The final expanded-MVP demo is tracked as a separate issue (see §0).
**Supersedes note:** the 2026-06-05 scope update (`docs/plans/2026-06-05-scope-update-du-kaku.md`) re-baselines the *final* slice 8 to land LAST, after #457–462 (luggage/map/doc/payment/admin). This doc is retained for its **core-path scope + mechanics**; its original "final Qiao demo" framing is superseded.
**Source of truth:** `docs/plans/2026-05-25-marketplace-mvp-proposal.md` (§6.1 E2E gate, §6.2 scoping, §7 NFRs, §8.2, §9 item 9) + the 2026-06-05 scope update (ordering).
**Slice intent (interim):** prove slices 3–7 integrate end-to-end on a seeded DB — *renter search → storefront → vehicle → book → confirmation visible in operator portal* — with a credible marketplace seed, a **real-DB** E2E gate, an i18n sweep, and verified perf budgets. Locks a regression guard before the payment/doc/admin work lands.

---

## 0. What this slice is (and is not)

This is the **interim core-path integration milestone** (#390) — it ships no new domain entity. It (a) replaces the legacy flat vehicle seed with a credible marketplace dataset, (b) lands the **renter happy-path Playwright test against the real web → API → seeded-DB stack** that is the §6.1 merge gate, (c) runs an **i18n parity + quality sweep**, (d) **verifies the §7 performance budgets as a hard gate**, and (e) produces a **demo runbook** for an internal core-path walkthrough.

**Acceptance (interim):** the flow shows *renter search → storefront result → vehicle selection → booking → confirmation notification visible in the operator portal*. That exact sentence is both the E2E assertion target (§5) and the runbook script (§8).

**Explicitly deferred to the FINAL expanded-MVP demo (separate issue, re-baselined after #457–462 per the 2026-06-05 scope update):** paid checkout (Stripe `payment_events`, #461), paid add-ons + reservation wizard (#460), document upload/verification (#459), map/flat-list search (#458), luggage filter (#457), and partner revenue/commission visibility (#462). The final Qiao demo must prove *discover → book → **pay** → partner revenue*; **this interim milestone does not, by design** — it locks the core path as a regression guard underneath that work.

**Not in scope:** any schema change, any new repo/service/route, any new feature UI. If the seed needs a column that does not exist, that is a defect in the owning slice (1–7), not a task here — treat it as an upstream bug, do not patch it.

---

## 1. Dependency status (now satisfied)

> **All slices this milestone consumes — 3, 4, 5, 6, 7 — are MERGED to `marketplace-pivot` (as of 2026-06-06).** The seed writes `operators`, `locations`, `vehicle_classes.acriss_code`, `vehicles` (operator/location/class FKs), `insurance_options`, `fee_schedules`, `bookings` (`requested_vehicle_id` / `assigned_vehicle_id` / `booking_code` / `insurance_option_id` / `insurance_snapshot` / `fee_snapshot`), `booking_events`, and `notification_log` — all present on the trunk now. **This milestone is unblocked.**

Status snapshot (2026-06-07):

| Provides | Slice / issue | State | Seed needs it for |
|---|---|---|---|
| `operators`, role enum, `CallerContext.operatorId` | #386 (slice 1) | **MERGED** | operator rows, scoped seed verification |
| `locations` + `vehicles.pickup_location_id` | #387 (slice 2) | **MERGED** (PR #414) | location rows, vehicle→location FK |
| `vehicle_classes.acriss_code` + vehicle CRUD | #388 (slice 3) | **MERGED** (PR #418) | ACRISS distribution across ~40 vehicles |
| `insurance_options`, `fee_schedules`, vehicle-only pricing | #404–406 (slice 4) | **MERGED** (PRs #421/#424/#427) | insurance + fee seed rows |
| storefront search read models | #391 (slice 5) | **MERGED** (PR #438) | E2E step 1–3 (search → storefront → vehicle) |
| `booking_events`, `bookings.*` marketplace cols, exclusion on `assigned_vehicle_id` | #392 (slice 6) | **MERGED** (PR #469) | sample bookings + E2E step 4 (book) |
| `EmailSender`, `notification_log`, operator notification badge | #393 (slice 7) | **MERGED** (PR #482) | E2E step 5 (operator-visible notification) |

**Entity shapes are cited from the proposal and merged slice migrations, not invented** — each seed builder consumes whatever the merged migration produced. Verify shapes against the merged schema at wire-up (§11 risks 2/4).

### 1.1 Re-baseline & the interim/final split (read this)

The 2026-06-05 scope update **supersedes proposal §6 ordering** and moves the *final* slice 8 demo to dead-last, after #457–462:

> 6 → 7 → luggage(#457)+map/list(#458) → doc(#459) → payment+add-ons(#460)+Stripe(#461) → admin revenue(#462) → **8 demo seed + E2E (#390)**.

So #390 is **split** to avoid letting an obsolete flow pass as "done":
- **This doc = the INTERIM core-path milestone** — lands now (deps merged), proves search→book→confirm on real infra, and stands as a regression guard for everything built on top.
- **A separate FINAL-demo issue** (re-baselined after #457–462) owns the *discover→book→pay→partner-revenue* Qiao demo. The seed/E2E/runbook mechanics here are its starting point.

Work already committed in worktree `kuruma-slice8-draftable` (`feat/slice8-draftable`, 7 commits): `seed-data/` fixtures, fleet, perf harness, Playwright skeleton, i18n checklist. **Remaining for this milestone:** real DB seed wire-up, the manual i18n sweep, the **real-DB E2E lane (#445)**, and converting the `test.fixme()` skeleton into real real-DB assertions (§5).

---

## 2. Current state (grounded in merged code)

| Asset | Path | Slice-8 disposition |
|---|---|---|
| Legacy vehicle seed | `packages/shared/src/db/seed.ts` | **Rewritten.** Today inserts 16 flat `SEED_VEHICLES` with `dailyRateJpy`/`hourlyRateJpy`/`bufferMinutes:60`, **no operator/location/class FK**. Marketplace seed supersedes it. |
| Legacy booking seed | `packages/shared/src/db/seed-bookings.ts` | **Rewritten.** Today writes `bookings` with `vehicleId` + `classId` + `effectiveEndAt`; marketplace schema replaces `vehicleId` with requested/assigned (§5.1) and adds `booking_code` + `booking_events`. |
| `db:seed` / `db:seed-bookings` commands | `package.json:24-25` | Repointed to the marketplace seed; ordering documented (§4). |
| Playwright config | `playwright.config.ts` | Reused. `testDir: ./e2e`, mock-API webServer on `:8787`, web dev on `:3001`, `screenshot: only-on-failure`, `trace: on-first-retry`. |
| Mock API | `e2e/mock-api.ts` | **Extended** with storefront-search / booking-submit / operator-notification fixtures (§5.3). |
| Existing mock-track E2E specs | `e2e/landing.spec.ts`, `e2e/browse.spec.ts` (#296 scaffold, #321 browse) | Kept as **smoke** (§5.3); the new real-DB `e2e/real-db/marketplace-happy-path.auth.spec.ts` (lane #416) is the additive **gate**. Existing specs guard against regressions per §6.2. |
| i18n messages | `packages/web/messages/{en,ja,zh}.json` | 9 namespaces (`common errors auth nav catalog vehicles business messaging bookings landing`), **501 keys each, in parity today**. Sweep adds the slice-5/6/7 namespaces and re-verifies. |
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

ACRISS first letter = category; classes live on `vehicle_classes.acriss_code` (proposal §2, §10 item 13). Distribution keeps every storefront searchable across classes:

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

≈ **41 vehicles**, 8 ACRISS codes, spread across all 3 operators and 9 locations (no operator has a single-class fleet — each storefront must return ≥3 distinct class summaries so the search-result card is convincing). Vehicles reuse the existing seed's make/model/photos/seats but **add** `operator_id`, `class_id` (ACRISS), `pickup_location_id`, per-vehicle `dailyRateJpy` (pricing lives on the vehicle now, §5.1), `shaken_expiry_date`, and `turnaround_minutes_override` on one vehicle to demo the override path. Plates are realistic Kansai format (`なにわ 300 あ 12-34`).

### 3.4 Insurance + fees (consume slice-4 schema)

Per `docs/plans/2026-06-02-slice4-*.md` §3–4 and proposal §2/§9 item 19:
- **Insurance** (`insurance_options`): each operator gets 2 rows — **Normal** (deductible ¥150,000) and **Premium** (deductible ¥250,000) from notes_02 defaults; operator-set `dailyPriceJpy` (e.g. ¥1,500 / ¥2,800).
- **Fee schedules** (`fee_schedules`): each operator gets the three platform fee types — `OVERTIME_HOURLY` (PER_HOUR, e.g. ¥1,000), `CLEANING_FLAT` (FLAT, e.g. ¥5,000), `NO_FUEL_FLAT` (FLAT, e.g. ¥3,000). At least one operator sets a per-class `OVERTIME_HOURLY` (e.g. higher for `PVAR`) to demo the per-class path and exercise the composite-FK seal.

### 3.5 Sample bookings + events (consume slice-6 schema)

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

Idempotency: delete-by-`@example.test` / delete-by-seeded-operator-slug before insert (same pattern as today's `seed.ts:307` and `seed-bookings.ts:31-35`). FK order matters — children deleted before parents, inserted parents-first. Run order per CLAUDE.md: `db:generate → db:migrate → db:seed → db:seed-bookings → db:verify`.

**`PLATFORM_ADMIN` is a special case (P2).** Admin users come from the env var `PLATFORM_ADMIN_EMAILS`, **not** `@example.test` and **not** an operator slug, so the delete-by patterns above do not cover them — and `users.email` is `UNIQUE` (`schema.ts:25`). Seed admins with an explicit **upsert keyed on email** (`INSERT … ON CONFLICT (email) DO UPDATE SET role='PLATFORM_ADMIN', …`), iterating the *current* `PLATFORM_ADMIN_EMAILS` list. Do **not** blanket-delete `role='PLATFORM_ADMIN'` rows (that would clobber a real admin). On re-seed with a changed env list, **do not** attempt to demote previously-seeded admins — tracking which rows the seed promoted would need a new ownership marker (e.g. a `seeded_by` column), and §0 forbids schema changes in this slice. **No-schema choice (explicit):** the seed only ever upserts the *current* `PLATFORM_ADMIN_EMAILS` to `PLATFORM_ADMIN`; a stale demo-admin (email dropped from the env list) is **left in place** — documented, accepted behaviour. Net: re-seeding never collides on the unique key and never needs schema.

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

New spec: `e2e/real-db/marketplace-happy-path.auth.spec.ts` — added to the **existing authenticated real-DB lane** (#416; §5.2), run via `bun run test:e2e:real-db`. **This is the required-green gate before slice 8 merge** (proposal §6.1: "renter search → storefront result → vehicle selection → book → confirmation email visible in operator portal"). Mutation-resistant assertions only — specific text/URL/role queries, never `toBeVisible()`-truthiness on a bare container.

### 5.1 Journey mapped to acceptance criteria

| Step | User action | Mutation-resistant assertion | Acceptance clause |
|---|---|---|---|
| 1. Search | Renter on `/en` fills pickup+return location, start+end datetime, class filter; clicks **Search** | URL → `/en/search?...`; result region has ≥1 storefront card; **`expect(cards.first()).toContainText('Best Car Rental')`** and the per-class summary text (`Compact ×N · from ¥X/day`) | "renter search → storefront result" |
| 2. Storefront result | Renter clicks the Best Car Rental Osaka card | URL → `/en/storefronts/best-car-rental/<location>`; heading `level:1` = operator+location name; available-vehicle list `toHaveCount(expected)` for the seeded date range | "storefront result" |
| 3. Vehicle selection | Renter picks the seeded `CCAR` Toyota Yaris | selection panel shows make/model/**license plate** + `dailyRateJpy` formatted as `¥8,000`; **insurance dropdown lists exactly the operator's 2 options** (Normal/Premium) | "vehicle selection" |
| 4. Booking | Renter selects Premium insurance, confirms dates, enters contact (email/name/phone/lang), submits | confirmation page URL contains `/booking/`; **booking-code matches `/^[2-9A-HJ-NP-Z]{8}$/`** (no-confusables alphabet, §9 item 3); page shows selected vehicle, selected Premium insurance, pre-auth handoff link (`href` = operator pre-auth URL), and a **"potential additional charges"** block listing the snapshotted overtime/cleaning/no-fuel fees | "vehicle selection → booking → confirmation" |
| 5. Operator-visible notification | Switch to operator session (Best Car Rental owner), open flat `/manage/bookings` | new booking row present with the **same booking-code** from step 4; **notification badge count incremented**; `notification_log` row rendered with `status: sent` (or `queued`) | "confirmation notification visible in operator portal" |

`test.step()` per row so the HTML report reads as the acceptance script. A failing step captures screenshot+trace (config already on). Run the renter journey on a mobile viewport variant too (proposal §8.2: iPhone/Android Chrome) — one extra project or `test.use({ viewport })` block.

### 5.2 What is mocked vs real — the REQUIRED gate is real-DB (proposal §6.2)

The proposal (§6.1/§6.2, test pyramid ~p.196) mandates the slice-8 E2E exercise the **real stack** — real web → real Hono API → seeded Postgres — with **only outbound HTTP boundaries stubbed**. The mock-API track that slices 5/6/7 specs use does **not** satisfy this gate: routing the API/DB path through `e2e/mock-api.ts` proves render/flow but not that the *real* search→book→notify contract works end-to-end. For an integration milestone, that real path is the whole point.

- **Mocked (outbound HTTP only):** Resend send (record the call; assert `notification_log.status` flips), OAuth callback (a test session helper mints the renter/operator JWT). **Nothing internal — no API, no DB — is mocked.**
- **Real:** web UI render + routing, the live Hono API (`e2e/real-db/real-api-server.ts`), the seeded Postgres branch, i18n resolution. Booking writes hit the real exclusion constraint; the notification row is written by the real `BookingPostCommitDispatcher`.

> **The real-DB lane already exists (#416).** `playwright.real-db.config.ts` boots the real Hono API (`e2e/real-db/real-api-server.ts`, :8788) + real web (:3002) against a `DATABASE_URL` Neon branch, with a minted Auth.js session (`e2e/real-db/auth.setup.ts` → `STORAGE_STATE`); specs matching `*.auth.spec.ts` run authenticated (see `e2e/real-db/locations.auth.spec.ts` for the pattern + `pg.ts` cleanup). Run with `bun run test:e2e:real-db` (needs `AUTH_SECRET` + `DATABASE_URL`). **Slice 8 adds `marketplace-happy-path.auth.spec.ts` to this lane and runs the seed against the branch in setup.** What remains is **#445** — wiring this lane as a *required CI gate* with a disposable per-run Neon branch (migrate→seed→test→drop); locally it already runs today. This is the "write" track of the two-track E2E strategy (`memory/project_e2e-strategy`). The mock-API specs (§5.3) stay as a fast pre-merge **smoke** check.

### 5.3 Mock-API smoke track (optional, fast pre-merge — NOT the gate)

The mock-API track is a fast smoke check, **not** the merge gate (§5.2). Most fixtures already exist from slices 5/6/7. Optionally top up endpoints mirroring the real contracts:
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
- [ ] `bun run lint:i18n-parity` green — all locales same key set (today: 501 keys × 3).
- [ ] After each slice 5/6/7 namespace lands, re-run; conflict resolution silently drops keys (CLAUDE.md i18n gotcha) — verify post-merge.
- [ ] New marketplace namespaces present in **all three** files: `search`/`storefront` (slice 5), `booking`/`confirmation` (slice 6), notification/email strings (slice 7).

**(b) Manual — quality (the #375 manual half the lint does NOT cover):**
- [ ] **Renter-facing en/ja/zh** (proposal §8.2 hard requirement): search form, storefront card, vehicle selection, booking form, confirmation page incl. selected insurance + "potential additional charges" block, confirmation email body — every value actually translated, not EN copied into JA/ZH.
- [ ] **Operator portal en/ja minimum** (zh optional per §8.2): locations, vehicles, insurance, fees, bookings list + notification badge.
- [ ] ACRISS class labels translated in all three (proposal §4 platform item 2).
- [ ] Outbound email templates (operator notification + renter confirmation) translated en/ja/zh (proposal §4 platform, §8.2 notification row).
- [ ] **Restart dev server after adding any new namespace** — `rm -rf packages/web/.next && bun run dev` (CLAUDE.md i18n gotcha: new namespaces need a restart).
- [ ] Operator-entered free-text is single-language per field by design (§9 item 4) — do **not** flag those as "missing translation".

---

## 7. Performance verification (proposal §7 / §8.2 budgets)

These NFRs are **explicitly verified in slice 8** (§7: "Next.js bundle already meets this; verify in slice 8"):

| Budget | Target | How verified in slice 8 |
|---|---|---|
| **First-load JS** | **< 500 KB** on renter pages (§7, §8.2 — "not negotiable") | **HARD GATE.** A script reads Next.js per-route "First Load JS" for `/`, `/search`, `/storefronts/*`, `/booking/*` from `bun run --filter @kuruma/web build` and **fails the merge** if any renter route exceeds 500 KB. If a route is genuinely over and cannot be trimmed in-slice, it requires an **explicit, written, owner-signed-off exception recorded in this doc and the PR** — never a silent follow-up. The proposal calls this budget "not negotiable." |
| **Search perf** | live availability < 500 ms p95 at MVP scale (3 ops × 40 vehicles) (§7, §8.2) | Hit the real search endpoint against the seeded `test`/dev branch; record p95 over ~50 runs. "Not enforced via SLO yet" (§7) — measure + record, do not gate. |
| **Responsive** | renter portal usable on iPhone + Android Chrome (§8.2) | E2E mobile-viewport variant (§5.1). |
| **Accessibility** | WCAG 2.1 AA — contrast, keyboard nav, aria on icon-only controls (§8.2) | Spot-audit renter happy-path pages (axe pass + keyboard-only run of the journey). |

Bundle measurement runs on the build output, independent of feature merges (§1.1 item 4) — can be wired early.

---

## 8. Demo runbook (cold-start → internal core-path walkthrough)

A `docs/runbooks/` markdown (or runbook section) the operator follows live. *(This is the **core-path subset** for an internal walkthrough; the full Qiao/Du demo — discover→book→pay→partner revenue — is #488.)*

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
| **E2E (Playwright, real-DB lane #416)** | `e2e/real-db/marketplace-happy-path.auth.spec.ts` (§5) via `test:e2e:real-db` — **the required §6.1 gate**. Mock-track `landing`/`browse` specs stay green as smoke (regression guard, §6.2). |

**Merge gate (proposal §6.1, all green):** `bun run test` · `bun run lint` · `bun run --filter @kuruma/api lint:boundaries` · `bun run lint:modules` · `bun run lint:i18n-parity` · `bun run db:verify` · **`AUTH_SECRET=… DATABASE_URL=<seeded-branch> bun run test:e2e:real-db` (real-stack happy-path green — required for slice 8; the mock-track `test:e2e` is smoke-only)** · code-reviewer + architect agents (`memory/feedback_review-before-ship`).

---

## 10. Execution order & worktree

```bash
# Existing worktree (7 commits of draftable-now work): ../kuruma-slice8-draftable on feat/slice8-draftable.
# All consumed slices (3–7) are merged, so rebase onto the trunk before wiring DB seed + real-DB E2E:
git -C ../kuruma-slice8-draftable fetch origin && git -C ../kuruma-slice8-draftable rebase origin/marketplace-pivot
```

All consumed slices (3–7) are merged, so the steps run back-to-back (no waiting). TDD where applicable (seed builders + booking-code generator are pure → unit-test first; the real-DB E2E journey is RED via `test.fixme` → GREEN as each seed/lane piece lands):

1. **Done (in worktree, 7 commits):** `seed-data/` fixtures, fleet, i18n checklist, Playwright skeleton, perf harness.
2. Wire `seed.ts` (operators→locations→classes→vehicles→insurance→fees) — incl. the `PLATFORM_ADMIN` email-upsert (§3.6); integration row-count tests green.
3. Wire `seed-bookings.ts` (bookings+events+`booking_code`+`fee_snapshot`+`notification_log`).
4. Add `e2e/real-db/marketplace-happy-path.auth.spec.ts` to the **existing real-DB lane (#416)**; run `db:seed`+`db:seed-bookings` against the branch in setup. (CI-gating + disposable per-run Neon branch lifecycle is **#445**.)
5. Convert the `test.fixme()` skeleton into real **real-DB** assertions; full §6.1 gate green on the real-DB lane.
6. i18n sweep (§6) + perf **hard-gate** verification (§7) + runbook (§8).
7. Rebase onto `origin/marketplace-pivot`, code-reviewer + architect, PR (`Closes #390`).

Always rebase, never force push (CLAUDE.md session protocol).

---

## 11. Resolved decisions / cross-slice risks

| # | Risk / question | Owner | Mitigation |
|---|---|---|---|
| 1 | **RESOLVED.** Slices 3–7 are all MERGED (2026-06-06); this interim milestone is unblocked. The *final* expanded-MVP demo is split to a separate issue, re-baselined after #457–462 (§1.1). | sequencing | Interim milestone lands now; final demo tracked separately so an obsolete flow can't pass as "done." |
| 2 | Seed needs a column a slice didn't ship (e.g. `operators.pre_auth_handoff_url`, `vehicles.turnaround_minutes_override`). | slices 2/7 | Treat as a defect in the owning slice; do **not** add schema in slice 8. Proposal §9 items 2 & 20 mandate these — verify present at wire-up. |
| 3 | Concurrent seed migration is N/A (slice 8 adds no migration) but seed **assumes journal is clean** post-5/6/7. | this slice | `db:verify` before seeding; watch the out-of-order `when` trap (CLAUDE.md 2026-04-17) if slices rebased. |
| 4 | Mock-API contract drifts from the real slice-5/6 API. | this slice | Only affects the **optional smoke track** (§5.3); the **required** E2E gate runs real web → real API → seeded DB (§5.2), so it cannot drift from the real contract. Keep mock fixtures loosely in sync for smoke value — the real lane is the source of truth. |
| 5 | i18n quality (vs parity) is manual and easy to skip. | this slice | §6(b) explicit checklist; lint catches parity, human catches EN-copied-into-JA. |
| 6 | First-load JS may exceed 500 KB once slice-5/6 renter pages land. | this slice | §7 is now a **hard gate** — merge fails if a renter route exceeds 500 KB; an over-budget route needs a written, owner-signed exception in this doc + PR, not a silent follow-up. |
| 7 | The required gate runs on the real-DB lane. **The lane already exists (#416)** — config, minted session, `real-api-server.ts`, example `*.auth.spec.ts`. | this slice | Slice 8 adds the happy-path `*.auth.spec.ts` + runs the seed against the branch. **#445** (CI-gating + disposable per-run Neon branch) is the remaining infra to make it a *required CI* gate; locally it already runs via `test:e2e:real-db`. |
| 8 | Booking-code regex must match the real generator alphabet exactly. | slice 6 | Verify the nanoid alphabet (`2-9A-HJ-NP-Z`, excludes `0 O 1 I l`) against slice-6's impl before asserting in E2E. |

---

## 12. Critical files

**New:** `e2e/real-db/marketplace-happy-path.auth.spec.ts` (added to the real-DB lane #416), `packages/shared/src/db/seed-data/*.ts`, demo runbook (`docs/runbooks/2026-demo-runbook.md` or runbook section).
**Modified:** `packages/shared/src/db/seed.ts`, `packages/shared/src/db/seed-bookings.ts`, `e2e/mock-api.ts` (smoke only), `package.json` (optional `db:seed:all`), `packages/web/messages/{en,ja,zh}.json` (sweep top-ups only — most keys ship in their owning slices).
**Read-only (verify, never modify):** `playwright.config.ts`, `playwright.real-db.config.ts` + `e2e/real-db/{auth.setup,mint-session,pg,real-api-server}.ts` (lane #416), `scripts/lint-i18n-parity.ts`, `packages/shared/src/db/schema.ts`.
