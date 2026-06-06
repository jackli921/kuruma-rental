# Marketplace MVP — Proposal & Execution Plan

**Date:** 2026-05-25
**Status:** Accepted for MVP implementation (Jack, 2026-05-27)
**Scope update (2026-06-05):** `docs/plans/2026-06-05-scope-update-du-kaku.md` (Du + Kaku alignment) amends §1/§2/§9/§10 — adds in-app payment, document upload + verification, a dual (map/flat-list + storefront) search model, paid add-ons, and a platform-admin revenue portal. MVP-vs-later triage pending.
**Supersedes:** 2026-04-28 email-hub pivot
**Anchored in:** `docs/internal/2026-05-24-qiao-du-meeting.md`, `docs/meeting_notes/2026_05_24_notes_02.txt`, Du follow-up notes from 2026-05-27

---

## 1. Direction summary

A multi-tenant Airbnb-style car rental marketplace. Partner operators register storefronts and list cars; foreign tourists search by pickup/return location + dates + car class, choose a storefront, then choose an available vehicle from that storefront. Built in the spirit of NicoNico Rent-A-Car but multi-tenant from day one.

**First operator:** Best Car Rental (Osaka), 30–40 cars. **Second wave:** Mr. Qiao's partner operators (count TBD).

**Out of MVP** (deferred, designed-for): online payment, pre-auth (lives on separate Stripe site), license/IDP/photo upload, calendar dashboards, cancellation/modification UI, OTA email parsing, Trip.com sync (Du's parallel work — integration boundary designed but not built).

---

## 2. Architecture decisions confirmed

| Decision | Choice | Reversibility |
|---|---|---|
| **Search result shape** | NicoNico-style storefront-first flow: search form filters by pickup/return datetime, pickup/return location, and class; results show storefront cards with per-class availability summaries; clicking a storefront shows available individual vehicles at that storefront for selection. | Storefront-first mirrors the reference UX and makes partner/location choice explicit |
| **Class display vs vehicle booking** | ACRISS class is the discovery/filtering/grouping layer; a concrete vehicle is selected before booking submit. Persist both `requested_vehicle_id` (what the renter chose) and `assigned_vehicle_id` (what the operator will fulfill). Initially they are the same. Postgres exclusion constraint on `(assigned_vehicle_id, time_range)` enforces uniqueness atomically. | Class-only booking would have a check-then-act race; selected-vehicle booking lets the DB constraint enforce uniqueness atomically while preserving a path for real-world substitutions |
| **Class taxonomy** | ACRISS 4-letter codes live on `vehicle_classes.acriss_code`; vehicles reference a class via `vehicles.class_id`; i18n friendly labels render in UI | Reversible (rename labels); adopting ACRISS aligns with OTA standard for future Trip.com sync |
| **Tenant routing** | Business portal under `/manage/<operator_slug>/...`; renter portal = single URL space (cross-operator search is the point) | Reversible via 301 + URL rewrites; subdomain swap is future post-MVP if white-label needed |
| **Tenant scoping enforcement** | Operator-scoped queries via `CallerContext.operatorId` for `OPERATOR_OWNER` / `OPERATOR_STAFF` — they **NEVER bypass**. Explicit `bypassScope = true` only for new `PLATFORM_ADMIN` role (env-gated). Legacy `STAFF` / `ADMIN` via `PRIVILEGED_ROLES` (`packages/api/src/middleware/auth.ts:50`) treated as platform-admin until retired post-MVP. | **Heuristic**: only platform-admin bypasses tenant scope; operator contexts never do. See §6.2 |
| **Availability query** | Live scan with Postgres exclusion constraint; no materialized view in MVP | Purely additive — materialize later if perf cliff |
| **Record mutation model** | Hybrid — mutable for reference data (operators, vehicles, classes, locations, insurance, prices), append-only `booking_events` for booking lifecycle, write-through to `bookings.current_state` for fast reads | Hybrid avoids both extremes; matches Airbnb/Uber/Stripe pattern |
| **Pricing model** | Operator-set per-vehicle; no platform floor in MVP (parked per §10 item 5) | Floor can be added later without breaking change |
| **Vehicle turnaround buffer** | Default 48-hour cooldown after return before the same vehicle is bookable again. Storefront/location default is operator-adjustable; vehicle-level override is allowed for exceptions. Availability and exclusion ranges use `effective_end_at = end_at + turnaround_minutes`. | Prevents immediate re-rental after return and preserves the existing exclusion-constraint model |
| **Booking write boundary** | Booking submit runs in one DB transaction: validate selected-vehicle availability, insert booking with `requested_vehicle_id` + `assigned_vehicle_id`, insert initial `booking_events`, snapshot applicable fees. Notification work happens after commit via `notification_log`. | Keeps atomic business state in Postgres while avoiding email/network side effects inside the transaction |
| **Vehicle substitution** | If the selected car becomes unavailable after booking, an operator may substitute another available vehicle from the same operator/location and same-or-better ACRISS class. Substitution updates `assigned_vehicle_id` in a transaction, rechecks availability/exclusion, and appends a `VEHICLE_SUBSTITUTED` booking event with old/new vehicle IDs and reason. | Handles normal rental-ops reality without reverting to vague class-only reservations; audit trail preserves what the renter originally selected |
| **Additive fees** | `fee_schedules` per operator (optionally per `vehicle_class_id`); platform-defined fee-type enum starts with `OVERTIME_HOURLY` + `CLEANING_FLAT` + `NO_FUEL_FLAT`. Overtime is charged as `ceil(overtime_hours) * hourly_rate_for_class`. At booking: snapshot applicable rows into `bookings.fee_snapshot jsonb` (locks rate-at-time-of-booking). MVP displays informationally on confirmation; no auto-compute/charge. | Snapshot pattern lets post-MVP checkout flow apply actual fees against locked rates without retroactive surprises |
| **Insurance** | Per-operator `insurance_options`; operator picks which apply per vehicle; seed defaults from notes_02 (150k normal / 250k premium) | Per-operator from start; platform-standard could overlay later |
| **Locations** | First-class entity, `operator_id` FK, N per operator; bookings carry `pickup_location_id` + `dropoff_location_id` (separate FKs; MVP UX defaults equal) | One-way rental unlocks without schema change |
| **Booking ID** | UUIDv7 internal + short alphanumeric `booking_code` for human/email reference | UUIDv7 keeps existing pattern (`project_architect-review`) |

### Reversibility verdict

None of the above will paint us into a corner. The two that *touch the most code* (auto-scope, append-only events) are pattern-level commitments that scale — undoing them is hypothetical, not foreseen.

---

## 3. Current state inventory (what's built)

### Reusable as-is — zero work

- Bun workspace monorepo; `api` / `web` / `shared` split
- Hono REST API on CF Workers with MVC + DI (routes → services → repositories)
- `CallerContext` pattern (PR #344 threaded through `VehicleRepository`) — extends naturally to tenant scoping
- Drizzle schema with `users`, `vehicleClasses`, `vehicles`, `bookings`, Postgres exclusion constraint, audit columns, migration workflow (`db:generate` + `db:migrate` + `db:verify`)
- Auth.js v5 (JWT strategy, Google + Apple OAuth) — already role-aware (`RENTER` / `STAFF` / `ADMIN`)
- i18n with next-intl (en / ja / zh)
- `DESIGN.md` visual system
- Cloudflare deployment pipeline + secrets management
- E2E + unit test harness

### Reusable with adaptation

| Asset | Adaptation needed |
|---|---|
| `/manage/*` owner pages | Retarget to logged-in **operator scope** via path-prefix routing |
| Renter catalog (#338) | Storefront-first aggregation; search returns location/store cards with per-class availability summaries |
| Renter booking flow (#345) | Storefront → available vehicle selection; insurance dropdown wired to operator's options |
| `vehicleClasses` table | Add `acrissCode` column; replace `dailyRateJpy`/`hourlyRateJpy` on the *class* with operator-set price on the *vehicle* (so each operator prices independently) |
| `users` table | Add `operatorId` (null for renters) + extend role enum to distinguish `OPERATOR_OWNER` vs `OPERATOR_STAFF` |
| Auth.js JWT callback | Propagate `operatorId` + role into session for guard checks |
| Existing booking flow | Switch to append-only event log (write-through to `bookings.current_state`) |

### Parked / out of MVP

- Migration epic #378 (Next.js → Vite) — orthogonal; can stay on Next.js for MVP demo work
- `react-big-calendar` work — calendar dashboard is post-MVP per Qiao
- All OTA email parsing — superseded
- Trip.com API ingestion — Du's parallel work; integration hook designed but not built here

---

## 4. MVP feature list

### Business portal (`/manage/<operator_slug>/...`)

1. Operator login (Auth.js, OAuth)
2. Locations / storefronts — list / add / edit / archive (per operator, N allowed), including default turnaround buffer (48 hours unless changed)
3. Vehicles — list / add / edit / archive, per location, capturing: license plate, ACRISS code, sha-ken expiry, status, photos optional placeholder
4. Insurance options — list / add / edit / archive (per operator), with name + daily price + deductible
5. Vehicle pricing — operator-set per-vehicle (no platform floor in MVP per §10 item 5)
6. Fee schedules — operator-set CRUD for `OVERTIME_HOURLY` / `CLEANING_FLAT` / `NO_FUEL_FLAT` per vehicle class (or operator-wide if no class specified)
7. Bookings — list with filters (location, status, date range), detail view
8. Inbound booking notifications — operator email + visible badge in portal

### Renter portal

1. Search — pickup location + return location + start datetime + end datetime + class filters → storefront cards across all operators
2. Storefront result card — operator/location name, address, distance/area, operating hours, per-class availability summary, min price, and representative photos
3. Storefront detail — available individual vehicles at that storefront for the selected date range, grouped/filterable by ACRISS class
4. Booking flow — select vehicle, select insurance, confirm pickup/return locations + dates, enter renter contact (email, name, phone, language)
5. Booking confirmation page — booking code, selected vehicle details (make/model/license plate), pickup details, **link to pre-auth handoff site** (operator's configured URL), and **"potential additional charges"** block listing snapshotted fees (overtime/hour, cleaning, no-fuel return) — informational only
6. Confirmation email — booking details + pre-auth link + potential additional charges + cancellation contact

### Platform / shared

1. Two-portal Auth.js (single Auth.js instance, role-based routing)
2. ACRISS taxonomy seed + i18n labels (en / ja / zh)
3. `booking_events` append-only log + write-through to `bookings.current_state`
4. Postgres exclusion constraint per `assigned_vehicle_id`
5. Outbound email via `EmailSender` interface (concrete vendor chosen at slice 7; Resend likely for DX) — see §10 item 2
6. Operator-scoped query enforcement via `CallerContext`
7. Operator onboarding for MVP — env-gated admin invite endpoint + seed script; no public self-serve

---

## 5. Gap analysis

| Layer | Status | Effort |
|---|---|---|
| **Schema retrofit** — `operators`, `locations`, `insurance_options`, `booking_events`, `booking_code`, `acriss_code`, `operator_id` FK across `vehicles` / `bookings` / `users`, `notification_log`, `fee_schedules`, `bookings.fee_snapshot`, default/override turnaround fields | New | 1–2 days |
| **API multi-tenancy** — extend `CallerContext` with `operatorId`, all repos auto-scope, `bypassScope` for admin paths, two-portal auth split (JWT carries operatorId + role) | Rework existing | 3–5 days |
| **Operator CRUD entities** — locations, insurance options, vehicle CRUD with ACRISS; onboarding seed/admin endpoint | New | 3–4 days |
| **Booking flow rework** — storefront-first cross-operator search, storefront detail vehicle selection, append-only event log + write-through, pre-auth handoff URL in confirmation | Rework existing | 3–4 days |
| **Operator portal UX** — `/manage/*` retargeted to operator scope, breadcrumbs, location/vehicle/insurance/booking screens | Rework existing | 2–3 days |
| **Outbound email** — `EmailSender` interface + one concrete impl, booking-notification template, confirmation template (en/ja/zh) | New | 1 day |
| **Demo seed data** — 3+ operators, 30+ vehicles, varied ACRISS codes, multiple locations, sample bookings | New | ~0.5 day |
| **Integration + i18n keys + polish** | — | 2–3 days |
| **E2E happy path** — renter search → book → notification email → operator sees it | New | 1–2 days |
| **Total** | | **~18–23 focused dev days** |

Migration epic #378 is **not** in this estimate.

---

### 5.1 Database setup strategy

No production data exists (deploy red since 2026-04-19). Drop the "preserve existing rows" framing — wipe + reseed on a fresh Neon branch is faster and cleaner.

| Step | What |
|---|---|
| 1 | Create Neon branch `marketplace-pivot` off current main |
| 2 | Point dev `.env` + API `.dev.vars` at the new branch |
| 3 | Run existing migrations to recreate baseline schema (no squashing — `CLAUDE.md` `drizzle/` is append-only) |
| 4 | **New marketplace migrations add**: `operators`, `locations`, `insurance_options`, `booking_events`, `notification_log`, `fee_schedules` tables; `operator_id` FK on `vehicles` / `vehicle_classes` / `bookings` / `users`; `locations.default_turnaround_minutes` default 2880 (48 hours); optional `vehicles.turnaround_minutes_override`; `acriss_code` column on `vehicle_classes`; `requested_vehicle_id`, `assigned_vehicle_id`, `booking_code text unique not null`, and `fee_snapshot jsonb` columns on `bookings`; exclusion constraint uses `assigned_vehicle_id`. **And drop**: `vehicle_classes.dailyRateJpy` + `vehicle_classes.hourlyRateJpy` columns and their CHECK constraints (`vehicle_classes_pricing_at_least_one`, `vehicle_classes_daily_rate_non_negative`, `vehicle_classes_hourly_rate_non_negative` per `schema.ts:93–104`) — pricing lives on `vehicles` exclusively post-marketplace. **And replace**: legacy nullable `bookings.vehicleId` (`schema.ts:179`) with selected/assigned vehicle semantics from §2. |
| 5 | New seed script creates Best Car Rental as operator #1 with sample vehicles tagged ACRISS, sample locations + insurance options |
| 6 | `bun run db:verify` after each migration (CI enforces) |
| 7 | When MVP demo-ready: promote `marketplace-pivot` → `main` via Neon |

No data backfill (no data exists). Schema is **transformed** from baseline to marketplace shape: legacy class-level pricing removed, requested/assigned vehicle semantics added, 48-hour default turnaround added, multi-tenancy + new tables added.

### 5.2 Neon branch strategy (long-lived)

Formalize three long-lived environments + short-lived feature branches:

| Branch | Purpose | Lifecycle |
|---|---|---|
| `main` | Production primary. Today: dev-shape single-tenant. After MVP demo: marketplace shape. | Long-lived |
| `marketplace-pivot` | Active MVP development. Wipe + reseed freely. | Long-lived through MVP delivery; promotes to `main` |
| `test` | CI integration tests. Reset between runs. | Long-lived; truncated by test setup |
| `feature/<issue-number>-<slug>` | Short-lived per-PR worktree branch for each MVP slice or post-MVP change | Created from `marketplace-pivot` during MVP, deleted on merge |
| `dev-<name>` | Optional personal sandboxes | On demand |

**Cost:** Neon free tier includes branching at zero extra cost.
**CI integration:** `db-drift` job runs against `test` (connection string as CI secret).
**Action at slice 1 kickoff:** create `marketplace-pivot` via Neon MCP / dashboard; update connection strings; verify with `db:verify`.

---

## 6. Vertical-slice execution plan (ordered)

Each slice = DB → API → UI → test → mergeable. Slices listed in dependency order; each is shippable.

| # | Slice | What ships | Days |
|---|---|---|---|
| **1** | **Tenancy foundation** | `operators` table, `operator_id` FK across users/vehicles/classes, `CallerContext.operatorId`, JWT carries operatorId + role, admin seed script to create operator records. Demo: log in as operator-staff, see scoped data only. | 2–3 |
| **2** | **Locations** | `locations` CRUD per operator, `/manage/<slug>/locations` UI, vehicles get `pickup_location_id`. Demo: operator adds Osaka location, attaches vehicles. | 1–2 |
| **3** | **ACRISS + vehicle CRUD** | `acriss_code` on `vehicle_classes`, taxonomy seed, i18n labels, operator vehicle CRUD with plate + sha-ken expiry. Demo: operator adds a Toyota Yaris in class "CCAR". | 2 |
| **4** | **Insurance + pricing + fees** | `insurance_options` per-operator CRUD, vehicle pricing per-operator (no platform floor in MVP), `fee_schedules` per-operator CRUD (`OVERTIME_HOURLY` / `CLEANING_FLAT` / `NO_FUEL_FLAT`, per-class or operator-wide). Demo: operator sets prices + insurance + fee schedule. | 2–3 |
| **5** | **Renter storefront search** | Storefront-first query: search returns storefront cards with per-class availability summaries; storefront detail shows available individual vehicles for the selected dates. Demo: renter sees "Best Car Rental Osaka — Compact x4, Minivan x2, from ¥4,500/day" and opens the store to choose a car. | 2–3 |
| **6** | **Booking + event log** | Append-only `booking_events`, write-through to `bookings.current_state`, selected-vehicle booking with `requested_vehicle_id` + `assigned_vehicle_id`, substitution event support, exclusion constraint on assigned vehicle, 48-hour default turnaround included in conflict range, `booking_code` generation, applicable `fee_schedules` snapshot to `bookings.fee_snapshot` at booking, confirmation page renders "potential additional charges". Demo: end-to-end booking with fee disclosure. | 3 |
| **7** | **Outbound notifications + pre-auth handoff** | `EmailSender` interface + concrete impl wired up (Resend likely), operator notification + renter confirmation templates (en/ja/zh), pre-auth URL per operator, confirmation page links to it, `notification_log` table. Demo: full booking sends emails. | 1–2 |
| **8** | **Demo seed + polish + E2E** | 3 operators × multi-location × ~40 vehicles across ACRISS codes, sample bookings, E2E happy-path test, i18n sweep. Demo: cold-start to Qiao demo. | 2–3 |

**Critical path:** 1 → 2 → 3 → 5/6 (5 and 6 can partially parallelize). 4, 7, 8 sequence after but each is small.

### 6.1 Test strategy per slice

Default test pyramid per slice (TDD vertical-slice per `~/.claude/rules/testing.md`):

| Layer | When | Boundary |
|---|---|---|
| **Unit** — services, validators, pure logic | Every slice | No internal mocks |
| **Integration** — repos against real Postgres | Every slice that touches DB | Neon dev branch or local Postgres |
| **E2E (Playwright)** — renter happy path | Slices 5, 6, 7, 8 (renter-facing) | Mock only HTTP boundaries (Resend, OAuth callbacks) |

**Per-slice merge gate** (all green):
- `bun run test` (unit + integration)
- `bun run lint`
- `bun run lint:boundaries` (API layer import direction)
- `bun run lint:modules` (feature module boundaries)
- `bun run db:verify` (schema/journal/DB sync)

**E2E happy-path gate**: required green before slice 6 and slice 8 merge. Test covers renter search → storefront result → vehicle selection → book → confirmation email visible in operator portal.

### 6.2 Tenant scoping policy + UI flow validation

With a fresh Neon branch and reseeded data (§5.1), there is no in-place data migration to coexist with. Two concerns to address:

**(a) Tenant scoping policy (non-negotiable, applies from slice 1 onward).**

Operator-staff is tenant-scoped, period. Only an explicit platform-admin context bypasses tenant scope. The current `PRIVILEGED_ROLES` global-bypass at `packages/api/src/middleware/auth.ts:50` must NOT be inherited by new operator roles.

- **Role taxonomy after slice 1:**
  - `RENTER` — no `operatorId`; queries filtered to that renter's own data
  - `OPERATOR_OWNER`, `OPERATOR_STAFF` (new) — `operatorId` set; queries always filtered to that operator's data; **NEVER bypass**
  - `PLATFORM_ADMIN` (new) — `operatorId = null` + `bypassScope = true`; env-gated (`PLATFORM_ADMIN_EMAILS` allowlist)
  - `STAFF` / `ADMIN` (legacy in `PRIVILEGED_ROLES`) — treated as `PLATFORM_ADMIN` until retired post-MVP; no new users get these roles
  - `PARTNER` (legacy Trip.com API caller) — out of scope until Du's integration revisits
- **Heuristic (per reviewer):** *only platform-admin contexts bypass tenant scope; operator contexts never do.*
- **Per-repo rollout is additive, not relaxation.** Each slice that touches a repo *adds* operator-scoped query support to it. Repos not yet updated continue to serve legacy `STAFF` / `ADMIN` callers (= platform-admin) globally, and **reject `OPERATOR_OWNER` / `OPERATOR_STAFF` callers until updated**. No repo ever auto-bypasses operator scope for operator callers.

**(b) UI flow validation across slices.**

- **JWT** adds `operatorId` + role in slice 1; existing routes ignore `operatorId` until they need it but never weaken auth.
- **Existing #345 + #338 E2E tests** are re-seeded against the marketplace shape (default operator = Best Car Rental Osaka) and run in CI throughout slices 1–6 — they catch regressions as scope tightens.
- **No feature flags in code** — slices are mergeable end-to-end; the gradient is via additive schema + per-repo operator-scoping migration, not branching auth paths.

---

## 7. Timeline

- **Lower bound:** 18 dev days (~3.5 weeks one-person solo, no interruptions)
- **Realistic:** 23 dev days (~4.5 weeks) with review cycles, Qiao question turnarounds, deploy/infra hiccups
- **Pessimistic:** 29 dev days (~6 weeks) if multi-tenancy retrofit surfaces hidden coupling

Recommend a **demo-ready target of 4 weeks** from green-light, with checkpoints at end of slice 4 (operator portal complete) and slice 6 (end-to-end booking works).

---

## 8. Demo environment / deploy bridge

Current deploy red since 2026-04-19. Migration spec (`docs/superpowers/specs/2026-04-18-migrate-web-off-nextjs-design.md`) measured the web Worker bundle at ~13.6 MiB — exceeds **both** CF Workers tiers (3 MiB free / 10 MiB paid). Paid tier alone may not unblock; the migration spec explicitly warns "we're already at 10.5 MiB on the handler alone."

**Conditional bridge plan:**

1. **OpenNext deploy dry-run on paid tier first** — 1–2 hour spike. Measure today's actual handler size (~6 weeks since spec was written; may have shifted in either direction).
2. **If under 10 MiB on paid tier:** CF Paid is the bridge. Proceed with MVP slices, no migration work pre-demo. ~$5/mo.
3. **If still over 10 MiB (likely per spec):** do **Vite migration slice 1 (shell-only)** before stakeholder staging. Adds ~3–5 days to timeline; produces a deploy path with permanent headroom (`packages/web/dist` target <2 MiB gzipped).

The migration spec already has slice 1 designed — Vite + TanStack Router shell with route stubs, deployable to CF Pages under free tier. We don't need full Next.js parity to ship the marketplace MVP: shell + new marketplace routes added in slices 1–8 = demo-ready. Slice 1 of migration epic #378 effectively becomes "slice 0" of this MVP if the dry-run fails.

---

### 8.1 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Multi-tenancy retrofit surfaces hidden coupling in existing services/repos | Medium | High | `lint:boundaries` enforces import direction; integration tests assert operator scoping at repo layer; per-repo opt-in (§6.2) limits blast radius per slice |
| Auth.js two-portal change breaks live login on next deploy | Medium | High | Single Auth.js instance (only adds `operatorId` to JWT, no provider/strategy change); ship slice 1 to staging first; smoke test on staging before merge |
| #345 / #338 UI flows regress as scope tightens across slices | Medium | High | E2E tests re-seeded against marketplace shape (default operator = Best Car Rental Osaka) and run in CI throughout slices 1–6; per-repo `requireOperatorScope` opt-in limits blast radius per slice |
| Tenant data leak (operator-staff sees another operator's data) | Low | Critical | Auto-scope in `CallerContext`; integration tests assert; code-reviewer agent runs on every PR per `~/.claude/CLAUDE.md` |
| Resend hits free-tier limit (3k emails/mo) | Low | Low | Free tier covers MVP demo + early operation; upgrade $20/mo when traffic warrants |
| Du's Trip.com sync conflicts with our schema later | Low | Medium | Reserve `bookings.external_source` + `external_id` columns in slice 1; Du writes via API not direct DB |
| Pre-auth handoff UX confuses tourists | Medium | Medium | Confirmation page explicitly explains the step; confirmation email reinforces; Du tests with a sample renter pre-demo |
| OpenNext bundle still >10 MiB on dry-run, forcing Vite slice 1 before staging | Medium | Medium | §8 conditional plan: 1–2 hour dry-run measures actual size at slice 1 kickoff; if over limit, Vite migration slice 1 (~3–5 days) becomes "slice 0" before stakeholder staging. Shell-only Vite deploy path has permanent headroom (<2 MiB gzipped) |
| Exclusion constraint deadlocks under concurrent bookings | Low | Low | Already proven for single-tenant; adding `operator_id` doesn't change behavior (constraint is per-`assigned_vehicle_id`) |

---

### 8.2 Non-functional requirements

Explicit minimums for MVP — not negotiable, not over-engineered:

| Area | Requirement | Notes |
|---|---|---|
| **Responsive** | Mobile-first; renter portal usable on iPhone + Android Chrome | DESIGN.md already covers; test viewports in E2E |
| **Accessibility** | WCAG 2.1 AA — color contrast, keyboard nav, aria labels on icon-only controls | Already in `~/.claude/rules/react.md` |
| **Search perf** | Live availability query <500ms p95 at MVP scale (3 ops × 40 vehicles) | Exclusion-constraint scan handles this trivially; not enforced via SLO yet |
| **First-load JS** | <500KB on renter pages | Next.js bundle already meets this; verify in slice 8 |
| **i18n coverage** | en/ja/zh for all renter pages + outbound emails; operator portal en/ja minimum (zh optional) | Operator-entered free-text is single-language per field (§9 item 4) |
| **Notification delivery** | At-least-once via Resend; failed sends visible to operator with manual-resend button | `notification_log` table; no DLQ in MVP |
| **Observability** | Existing CF Workers logs + server-side error logging via console.error; no Sentry/Datadog in MVP | Add structured tracing post-MVP when paid tier lands |
| **Backups** | Neon's built-in PITR | No custom backup needed |

---

## 9. Further considerations (things to flag now)

These are either resolved defaults or implementation notes that should stay visible before slice 1 starts:

1. **Operator onboarding mechanism for MVP** — recommend env-gated admin invite endpoint + DB seed. Public self-serve = post-MVP. Without this nothing exists to onboard slice-2 vehicles against.
2. **Pre-auth handoff URL per operator** — needs a column on `operators` for the renter-confirmation page to link out. Trivial schema add now; awkward retrofit later.
3. **Booking code format** — 8-char no-confusables base32 nanoid (e.g., `2J7QXKN4`), no prefix. Resolved per §10 item 3. Added to schema in slice 6 (`bookings.booking_code text unique not null`).
4. **Per-operator content i18n** — operator-entered fields (location names, insurance names) entered in **one display language per field** for MVP; future = machine-translate or operator multi-fill. Don't design for multi-language fields yet.
5. **Outbound email vendor** — design `EmailSender` interface in `packages/api/src/services/email/` with methods like `sendBookingNotification(...)`, `sendBookingConfirmation(...)`. Slice 7 picks one concrete (likely Resend for DX), but **swap cost = one repository class**; no vendor lock-in at any call site. Generic-by-design per user direction.
6. **External-source plug point for Du** — add nullable `external_source` + `external_id` columns to `bookings` now (cost: ~zero). Lets Trip.com sync write into our DB later without schema churn. Honors "our DB = source of truth" decision.
7. **Renter cancellation in MVP** — no UI per Q7. Event log is present; operator cancels manually from portal on renter request (phone/email). Acceptable for demo.
8. **Sha-ken expiry reminders** — data column required now (`shaken_expiry_date`); reminder UX is post-MVP.
9. **Demo seed data scale** — 3 operators × 3 locations × ~40 vehicles across 6–8 ACRISS codes is the credibility floor for a Qiao demo.
10. **Renter auth** — keep Google + Apple OAuth. No magic-link for MVP; tourists already have Google. Same Auth.js instance, different role.
11. **Pricing granularity** — recommend per-vehicle for flexibility; if operator wants class-uniform pricing they set all vehicles in the class to the same price. Schema = vehicle-level always.
12. **Time-of-day pickup/return** — keep existing `timestamptz` model (hourly granularity already supported per current schema).
13. **Currency** — JPY only. No conversion in MVP. Trip.com integration will surface multi-currency later, not now.
14. **Trip.com / Du integration boundary** — beyond #6, design `bookings.source` enum already includes `TRIP_COM` per current schema; honor that.
15. **Operator slug strategy** — auto-generated from operator name on creation (kebab-case, ASCII, max 32 chars). Collisions append numeric suffix (`acme-2`). Editable only by platform admin (env-gated endpoint), not by operator. Stored as `operators.slug text unique not null`. Used in `/manage/<slug>/...`.
16. **KANATA / three-party structure** — KANATA STUDIO is platform owner, **implicit** in the data model (no row, no entity). `operators` table holds rental businesses; Best Car Rental is operator #1. Kaku is a business-arrangement concern (sourcing + payment intermediary per `memory/project_business-structure.md`), not a system entity. Commission / revenue-share is **post-MVP** — no money flows through the platform yet (payment is at-store). When that lands, design a `commission_terms` table per-operator.
17. **Notification reliability** — at-least-once delivery via Resend's built-in retry. Persist a `notification_log` row per send (`status: queued | sent | failed`). Failed sends visible in operator portal with manual-resend button. No DLQ for MVP.
18. **Platform brand on renter portal** — renter portal is **platform-neutral** (multi-operator marketplace). Per-card operator name shows as a label, not as branding. Domain near-term is `bestcarrental.jp` per `memory/project_company-identity.md`, with cross-operator listings on it (the brand becomes the marketplace name, not exclusively Mr. Qiao's business).
19. **Additive fees / potential charges** — `fee_schedules` table per-operator, optionally per-class via nullable `vehicle_class_id` FK. Platform-defined fee-type enum starts with `OVERTIME_HOURLY` + `CLEANING_FLAT` + `NO_FUEL_FLAT` for MVP. Operator sets `amount_jpy` + `unit` (`PER_HOUR` / `PER_DAY` / `PER_KM` / `FLAT`) per row. Overtime calculation rule from Du: `ceil(actual_return_overage_hours) * snapshotted_overtime_hourly_rate_for_class`. At booking, applicable rows snapshot into `bookings.fee_snapshot jsonb` — locks rate-at-time-of-booking so post-MVP checkout charges against the locked rate, not the current one. Confirmation page + email display them as "potential additional charges" — informational only in MVP. Auto-application at checkout is post-MVP (needs damage-assessment + final-charge flow). Pattern matches NicoNico / Hertz fee disclosure.
20. **Turnaround buffer** — default cooldown is 48 hours after scheduled return before the same vehicle appears as available again. Operators can adjust at storefront/location level; individual vehicles can override when needed. Existing `bufferMinutes` concept should be renamed or mapped to `turnaround_minutes` so implementers do not leave the old 60-minute default in place.
21. **Search API contract** — use two renter-facing read models: storefront search returns location/storefront cards with `class_summaries`; storefront detail returns available vehicles for the selected date range + class filters. Do not return a flat cross-operator vehicle list as the primary search result.
22. **Booking transaction boundary** — selected-vehicle booking is one DB transaction for availability validation, booking insert with requested/assigned vehicle IDs, first event insert, and fee snapshot. Email/notification side effects are queued/logged after commit only.
23. **Platform admin bootstrap** — seed the first platform admin from `PLATFORM_ADMIN_EMAILS`; expose only env-gated admin endpoints for operator creation/invite during MVP. Public operator signup is post-MVP.
24. **Issue/worktree policy** — create one GitHub epic for the marketplace MVP, then one GitHub issue per vertical slice. Implementation agents work from one issue at a time on `feature/<issue-number>-<slug>` branches/worktrees off `marketplace-pivot`.
25. **Vehicle substitution** — bookings keep both `requested_vehicle_id` and `assigned_vehicle_id`. Operators can replace the assigned car when the original is broken/unavailable, but only with an available same-operator, same-location, same-or-better-class vehicle. Every substitution appends a `VEHICLE_SUBSTITUTED` event with actor, old/new vehicle IDs, and reason.

---

## 10. Decisions (resolved during walkthrough)

Initial walkthrough decisions from 2026-05-25 plus Du follow-up decisions from 2026-05-27; recorded here for traceability.

1. **Database setup** — wipe + reseed on a fresh Neon branch (`marketplace-pivot`). No data migration cost; pricing model is "vehicles own prices" from day one. See §5.1.
2. **Email vendor** — abstracted behind `EmailSender` interface in `packages/api/src/services/email/`. Vendor chosen at implementation time, swappable. No lock-in at call sites. See §9 item 5.
3. **Booking code format** — 8-character no-confusables base32 nanoid (alphabet excludes `0 O 1 I l`), pattern like `2J7QXKN4`. Industry standard for human-facing booking refs (Airbnb-class — Hertz/Avis use 7–9 char alphanumeric, Niconico uses 8 numeric). Stored as `bookings.booking_code text unique not null`; generated with `nanoid` (~1KB library, custom alphabet). Internal UUIDv7 still on `bookings.id`. **Rejected**: semantic slug (collision-management complexity, PII risk, harder to recite over phone).
4. **Deploy bridge** — conditional on dry-run. If OpenNext deploy fits under 10 MiB on paid tier: pay $5/mo. If still over (likely per spec): run Vite migration slice 1 before stakeholder staging. See §8.
5. **Platform price floors** — **parked**. Operators set their own prices with no platform floor for MVP. Vehicle pricing in slice 4 is operator-only. Revisit post-MVP if race-to-bottom pricing becomes observable.
6. **Du discovery session** — still relevant; schedule during slices 2–3 (before slice 4 starts). Targeted at his daily workflow + operator-portal information architecture. Output may surface follow-up work in slice 7–8 polish.
7. **Operator approval workflow** — invite-only via env-gated admin endpoint for MVP. Matches "partners register as they come" framing — when a partner says yes, Jack creates the operator account. Self-serve signup form is post-MVP.
8. **Booking modification UI** — none in MVP. Event log makes modification trivially addable post-MVP without schema change.
9. **Additive cost model** — `fee_schedules` per-operator (optionally per-class) with platform-defined fee-type enum: `OVERTIME_HOURLY` + `CLEANING_FLAT` + `NO_FUEL_FLAT` for MVP. At booking, applicable fees snapshot to `bookings.fee_snapshot jsonb` locking rate-at-time-of-booking. Overtime is later computed as rounded-up overage hours times the snapshotted hourly class rate. Confirmation page + email show informationally; auto-charge at checkout is post-MVP. See §9 item 19 for full schema sketch.
10. **NicoNico-style renter flow from Du follow-up** — landing/search collects pickup/return datetime, pickup/return location, and class filters; results are storefront cards with class availability summaries; storefront detail shows available individual vehicles; booking reserves the selected vehicle.
11. **Turnaround buffer** — default 48 hours after return; configurable by storefront/location with optional vehicle override. Availability and booking conflict ranges use the chosen turnaround.
12. **Search contract** — storefront cards first, storefront vehicle detail second. This is the primary renter search model; flat all-vehicle search is rejected for MVP because it hides the operator/location choice.
13. **ACRISS placement** — `vehicle_classes.acriss_code` is canonical; vehicles point to classes. Rejected: duplicating ACRISS on vehicles unless a future integration proves class records cannot express the needed variance.
14. **Booking transaction boundary** — booking submit is one DB transaction for selected vehicle availability, booking row with requested/assigned vehicle IDs, initial event, and fee snapshot; notifications happen after commit through `notification_log`.
15. **Platform admin bootstrap** — seed + env-gated admin endpoint for MVP operator onboarding. Public self-serve registration is post-MVP.
16. **Implementation issue strategy** — one epic issue plus one issue per vertical slice; each slice gets its own worktree branch from `marketplace-pivot`.
17. **Vehicle substitution** — selected-vehicle booking remains the default, but the data model tracks requested vs assigned vehicle so operators can handle broken/unavailable cars without losing auditability or DB-level conflict protection.

---

## 11. What I recommend now

All §10 decisions resolved. Remaining preconditions before slice 1:

1. **OpenNext deploy dry-run** (1–2 hour spike) — measure actual bundle size; determines whether Vite slice 1 is in scope before MVP demo.
2. **Schedule Du discovery** — non-blocking through slice 4; valuable for operator-portal information architecture.
3. **Create Neon `marketplace-pivot` branch** at slice 1 kickoff via Neon MCP / dashboard.
4. **Create GitHub tracking issues** — one epic issue for this plan, then slice issues beginning with slice 1 (tenancy foundation).
5. **Start slice 1 (tenancy foundation)** — worktree on a feature branch off `marketplace-pivot`; TDD vertical-slice per `~/.claude/rules/testing.md`; merge gate per §6.1.

Total to demo-able MVP: ~4 weeks of focused work after kickoff (~+3–5 days if Vite slice 1 is required).
